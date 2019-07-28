// homebridge-zp/lib/ZpClient.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const dns = require('dns')
const events = require('events')
const he = require('he')
const homebridgeLib = require('homebridge-lib')
const request = require('request')
const ZpXmlParser = require('./ZpXmlParser')

const ipRegExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

let instanceId = 0

// Display channels in channelMapSet.
const channelMap = {
  'LF,LF': 'L',
  'RF,RF': 'R'
}
// Display channels for htSatChanMapSet.
const htChannelMap = {
  'LF,RF': '',
  'SW': 'Sub',
  'LR': 'LS',
  'RR': 'RS'
}

class ZpClient extends events.EventEmitter {
  // Return the properties from a zoneGroupState member object.
  static parseMember (member) {
    const props = {
      address: member.location.split('/')[2].split(':')[0],
      baseUrl: member.location.split('/').slice(0, 3).join('/'),
      airPlay: member.airPlayEnabled === 1,
      bootSeq: member.bootSeq,
      channel: null,
      homeTheatre: false,
      id: member.uuid,
      name: member.zoneName,
      role: member.invisible === 1 ? 'slave' : 'master',
      stereoPair: false,
      zoneName: member.zoneName,
      zoneDisplayName: member.zoneName
    }
    // Check for stereo pair.
    if (member.channelMapSet != null) {
      props.stereoPair = true
      const array = member.channelMapSet.split(';')
      const channels = array.map((element) => {
        const channel = element.split(':')[1]
        return channelMap[channel] == null ? channel : channelMap[channel]
      })
      props.zoneDisplayName += ' (' + channels.join('+') + ')'
      for (const index in array) {
        if (array[index].startsWith(member.uuid)) {
          props.channel = channels[index]
        }
      }
    }
    // Check for home theatre setup.
    if (member.htSatChanMapSet != null) {
      props.homeTheatre = true
      const array = member.htSatChanMapSet.split(';')
      const channels = array.map((element) => {
        const channel = element.split(':')[1]
        return htChannelMap[channel] == null ? channel : htChannelMap[channel]
      })
      props.zoneDisplayName += ' (' + channels.join('+') + ')'
      if (member.invisible === 1) { // satallite
        props.role = 'satellite'
        for (const index in array) {
          if (array[index].startsWith(member.uuid)) {
            props.channel = channels[index]
          }
        }
      }
    }
    if (props.channel != null) {
      props.name += ' (' + props.channel + ')'
    }
    return props
  }

  // Create a new instance of ZpClient.
  constructor (options) {
    super()
    this._instanceId = instanceId++
    this._requestId = 0
    this._debug = debug('ZpClient:call:' + instanceId)
    this._debugRequest = debug('ZpClient:request:' + instanceId)
    this._debugHttp = debug('ZpClient:http:' + instanceId)
    this._debug('constructor(%j)', options)

    this._jsonFormatter = new homebridgeLib.JsonFormatter()
    this._parser = new ZpXmlParser()

    this._config = {
      subscriptionTimeout: 30,
      timeout: 5
    }
    const optionParser = new homebridgeLib.OptionParser(this._config)
    optionParser.hostKey()
    optionParser.stringKey('id')
    optionParser.intKey('timeout', 1, 60) // seconds
    optionParser.intKey('subscriptionTimeout', 1, 1440) // minutes
    optionParser.parse(options)
    this._config.timeout *= 1000 // seconds -> milliseconds
    this._config.subscriptionTimeout *= 60 // minutes -> seconds

    this._props = {}
    this._subscriptions = {}
    this._urlCache = {}

    this._debug('constructor(%j) --> %j', options, this._config)
  }

  // ***** Initialisation ******************************************************

  // Properties.
  get address () { return this._props.address }
  get airPlay () { return this._props.airPlay }
  get audioIn () { return this._props.audioIn }
  get balance () { return this.audioIn || this.stereoPair }
  get baseUrl () { return this._props.baseUrl }
  get bootSeq () { return this._props.bootSeq }
  get channel () { return this._props.channel }
  get homeTheatre () { return this._props.homeTheatre }
  get id () { return this._props.id }
  get lastSeen () {
    return this._props.lastSeen == null
      ? null
      : Math.round((new Date() - this._props.lastSeen) / 1000)
  }
  get modelName () { return this._props.modelName }
  get modelNumber () { return this._props.modelNumber }
  get name () { return this._props.name }
  get role () { return this._props.role }
  get stereoPair () { return this._props.stereoPair }
  get tvIn () { return this._props.tvIn }
  get version () { return this._props.version }
  get zoneName () { return this._props.zoneName }
  get zoneDisplayName () { return this._props.zoneDisplayName }

  get info () {
    return {
      address: this.address,
      airPlay: this.airPlay,
      audioIn: this.audioIn,
      balance: this.balance,
      baseUrl: this.baseUrl,
      bootSeq: this.bootSeq,
      channel: this.channel,
      homeTheatre: this.homeTheatre,
      id: this.id,
      lastSeen: this.lastSeen,
      modelName: this.modelName,
      modelNumber: this.modelNumber,
      name: this.name,
      role: this.role,
      stereoPair: this.stereoPair,
      tvIn: this.tvIn,
      version: this.version,
      zoneName: this.zoneName,
      zoneDisplayName: this.zoneDisplayName
    }
  }

  get subscriptions () {
    const a = []
    for (const url in this._subscriptions) {
      a.push(url)
    }
    return a.sort()
  }

  get zones () {
    const zones = {}
    Object.keys(this._zones).sort().forEach((zoneName) => {
      const zone = this._zones[zoneName]
      zones[zoneName] = Object.assign({}, zone)
      zones[zoneName].zonePlayers = {}
      Object.keys(zone.zonePlayers).sort().forEach((zonePlayerName) => {
        zones[zoneName].zonePlayers[zonePlayerName] = zone.zonePlayers[zonePlayerName]
      })
    })
    return zones
  }

  get zonePlayers () {
    const zonePlayers = {}
    Object.keys(this._zones).sort().forEach((zoneName) => {
      const zone = this._zones[zoneName]
      Object.keys(zone.zonePlayers).sort().forEach((zonePlayerName) => {
        zonePlayers[zonePlayerName] = zone.zonePlayers[zonePlayerName]
      })
    })
    return zonePlayers
  }

  async init () {
    this._debug('init()')
    this._props.lastSeen = null
    if (ipRegExp.test(this._config.hostname)) {
      this._props.address = this._config.hostname
    } else {
      this._props.address = (await this._lookup())
        .split('.').map((i) => { return parseInt(i) }).join('.')
    }
    this._config.hostname = this._props.address
    this._props.baseUrl = 'http://' + this._props.address + ':1400'

    const deviceDescription = await this.get()
    const id = deviceDescription.device.udn.split(':')[1]
    if (this._config.id != null && this._config.id !== id) {
      this.emit('error', new Error('address mismatch'))
      return
    }
    this._config.id = id
    this._props.audioIn = false
    this._props.balance = false
    this._props.id = id
    this._props.modelName = deviceDescription.device.modelName
    this._props.modelNumber = deviceDescription.device.modelNumber
    this._props.version = deviceDescription.device.displayVersion
    this._props.tvIn = false
    for (const service of deviceDescription.device.serviceList) {
      switch (service.serviceId.split(':')[3]) {
        case 'AudioIn':
          this._props.audioIn = true
          break
        case 'HTControl':
          this._props.tvIn = true
          break
        default:
          break
      }
    }

    const zoneGroupState = await this.getZoneGroupState()
    this._zones = {}
    zoneGroupState.zoneGroups.forEach((group) => {
      group.zoneGroupMembers.forEach((member) => {
        const props = ZpClient.parseMember(member)
        let zone = this._zones[member.zoneName]
        if (zone == null) {
          zone = { master: null, name: props.zoneName, zonePlayers: {} }
          this._zones[member.zoneName] = zone
        }
        let zoneDisplayName
        if (member.invisible !== 1) {
          zone.master = props.name
          zoneDisplayName = props.zoneDisplayName
        }
        zone.zonePlayers[props.name] = props
        if (props.id === this._config.id) {
          Object.assign(this._props, props)
        }
        if (member.satellites != null) {
          for (const satellite of member.satellites) {
            const props = ZpClient.parseMember(satellite)
            props.zoneDisplayName = zoneDisplayName
            zone.zonePlayers[props.name] = props
            if (props.id === this._config.id) {
              Object.assign(this._props, props)
            }
          }
        }
      })
    })
    this._debug('init() --> %j', this._props)
  }

  // Resolve hostname to normalised IPv4 address.
  // Note that Sonos zoneplayers only accept HTTP requests to the IP address.
  // A request to the hostname results in an Error 400: Bad request.
  async _lookup () {
    const hostname = this._config.hostname
    if (ipRegExp.test(hostname)) {
      // IPv4 address.
      return hostname
    }
    return new Promise((resolve, reject) => {
      dns.lookup(hostname, { family: 4 }, (error, address, family) => {
        if (error != null) {
          return reject(new Error(`${hostname}: cannot resolve hostname`))
        }
        return resolve(address)
      })
    })
  }

  // ***** Event Handling ******************************************************

  async open (zpListener) {
    // check zpListener instance of ZpListener
    this._debug('open()')
    this._zpListener = zpListener
    this._config.callbackUrl = await this._zpListener.addClient(this)
    this.on('event', (device, service, payload) => {
      try {
        this._props.lastSeen = new Date()
        // const f = `handle${device}${service}Event`
        // if (this[f] != null) {
        //   this[f](payload)
        // }
      } catch (error) {
        this.emit('error', error)
      }
    })
    this._debug('open() => %j', this._config)
  }

  async close () {
    for (const url in this._subscriptions) {
      try {
        await this.unsubscribe(url)
      } catch (error) {
        this.emit('error', error)
      }
    }
    this.removeAllListeners('event')
    if (this._config.callbackUrl != null) {
      await this._zpListener.removeClient(this)
    }
    delete this._config.callbackUrl
  }

  async subscribe (url) {
    this._debugRequest('subscribe(%j)', url)
    if (this._config.callbackUrl == null) {
      this.emit('error', new Error('subscribe() before open()'))
    }
    let sid
    if (this._subscriptions[url] != null) {
      sid = this._subscriptions[url].sid
      clearTimeout(this._subscriptions[url].timeout)
      delete this._subscriptions[url]
    }
    const callbackUrl = this._config.callbackUrl + url
    const requestObj = {
      url: url,
      method: 'SUBSCRIBE',
      headers: {
        TIMEOUT: 'Second-' + this._config.subscriptionTimeout
      }
    }
    if (sid == null) {
      requestObj.headers.CALLBACK = '<' + callbackUrl + '>'
      requestObj.headers.NT = 'upnp:event'
    } else {
      requestObj.headers.SID = sid
    }
    const response = await this._request(requestObj)
    const timeout = setTimeout(() => {
      this.subscribe(url).catch((error) => {
        this.emit('error', error)
        this.subscribe(url).catch((error) => { this.emit('error', error) })
      })
    }, (this._config.subscriptionTimeout - 30) * 1000)
    this._subscriptions[url] = {
      sid: response.headers.sid,
      timeout: timeout
    }
    this._debugRequest('subscribe(%j) --> %s', url, response.headers.sid)
  }

  async unsubscribe (url) {
    this._debugRequest('unsubscribe(%j)', url)
    if (this._subscriptions[url] == null) {
      return
    }
    const sid = this._subscriptions[url].sid
    clearTimeout(this._subscriptions[url].timeout)
    delete this._subscriptions[url]
    const requestObj = {
      url: url,
      method: 'UNSUBSCRIBE',
      headers: {
        SID: sid
      }
    }
    await this._request(requestObj)
    this._debugRequest('unsubscribe(%j) --> OK', url)
  }

  _checkBootSeq (bootSeq) {
    if (bootSeq === this._props.bootSeq || this._props.bootSeq == null) {
      return
    }
    const oldBootSeq = this._props.bootSeq
    this._props.bootSeq = bootSeq
    this._urlCache = {}
    for (const url in this._subscriptions) {
      clearTimeout(this._subscriptions[url].timeout)
      delete this._subscriptions[url]
      this.subscribe(url).catch((error) => { this.this.emit('error', error) })
    }
    this._props.urlCache = {}
    this.emit('rebooted', oldBootSeq)
  }

  _checkAddress (address) {
    if (address === this._props.address) {
      return
    }
    const oldAddress = this._props.address
    this._props.address = address
    this._props.baseUrl = 'http://' + this._props.address + ':1400'
    this._config.hostname = this._props.address
    this.emit('addressChanged', oldAddress)
  }

  handleUpnpMessage (address, message) {
    if (this._props.id != null && message.usn.split(':')[1] !== this._props.id) {
      return
    }
    this._props.lastSeen = new Date()
    this._checkAddress(address)
    this._checkBootSeq(parseInt(message['x-rincon-bootseq']))
  }

  handleZoneGroupState (zoneGroupMember) {
    if (this._props.id != null && zoneGroupMember.uuid !== this._props.id) {
      return
    }
    this._checkAddress(zoneGroupMember.location.split('/')[2].split(':')[0])
    this._checkBootSeq(zoneGroupMember.bootSeq)
    if (zoneGroupMember.zoneName !== this.zoneName) {
      this.emit('topology')
    }
  }

  // ***** Control *************************************************************

  // AlarmClock

  async listAlarms () {
    return this.post('ZonePlayer', 'AlarmClock', 'ListAlarms', {})
  }

  async updateAlarm (alarm) {
    return this.post('ZonePlayer', 'AlarmClock', 'UpdateAlarm', {
      ID: alarm.id,
      StartLocalTime: alarm.startTime,
      Duration: alarm.duration,
      Recurrence: alarm.recurrence,
      Enabled: alarm.enabled,
      RoomUUID: alarm.roomUuid,
      ProgramURI: he.escape(alarm.programUri),
      ProgramMetaData: ZpClient.meta(alarm.programMetaData),
      PlayMode: alarm.playMode,
      Volume: alarm.volume,
      IncludeLinkedZones: alarm.includeLinkedZones
    })
  }

  // DeviceProperties

  async getButtonLockState () {
    return (await this.post(
      'ZonePlayer', 'DeviceProperties', 'GetButtonLockState', {}
    )).currentButtonLockState === 'On'
  }

  async setButtonLockState (state) {
    return this.post('ZonePlayer', 'DeviceProperties', 'SetButtonLockState', {
      DesiredButtonLockState: state ? 'On' : 'Off'
    })
  }

  async getLedState () {
    return (await this.post(
      'ZonePlayer', 'DeviceProperties', 'GetLEDState', {}
    )).currentLedState === 'On'
  }

  async setLedState (state) {
    return this.post('ZonePlayer', 'DeviceProperties', 'SetLEDState', {
      DesiredLEDState: state ? 'On' : 'Off'
    })
  }

  async getZoneAttributes () {
    return this.post('ZonePlayer', 'DeviceProperties', 'GetZoneAttributes', {})
  }

  async getZoneInfo () {
    return this.post('ZonePlayer', 'DeviceProperties', 'GetZoneInfo', {})
  }

  // ZoneGroupTopology

  async getZoneGroupAttributes () {
    return this.post('ZonePlayer', 'ZoneGroupTopology', 'GetZoneGroupAttributes', {})
  }

  async getZoneGroupState () {
    return this.post('ZonePlayer', 'ZoneGroupTopology', 'GetZoneGroupState', {})
  }

  // MediaRenderer AVTransport

  async play () {
    return this.post('MediaRenderer', 'AVTransport', 'Play', {
      InstanceID: 0,
      Speed: 1
    })
  }

  async pause () {
    return this.post('MediaRenderer', 'AVTransport', 'Pause', {
      InstanceID: 0
    })
  }

  async stop () {
    return this.post('MediaRenderer', 'AVTransport', 'Stop', {
      InstanceID: 0
    })
  }

  async next () {
    return this.post('MediaRenderer', 'AVTransport', 'Next', {
      InstanceID: 0
    })
  }

  async previous () {
    return this.post('MediaRenderer', 'AVTransport', 'Previous', {
      InstanceID: 0
    })
  }

  async setAvTransportUri (uri, metaData = '') {
    return this.post('MediaRenderer', 'AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metaData
    })
  }
  async setAvTransportAirPlay () {
    // TODO test
    return this.setAvTransportUri('x-sonosapi-vli:' + this.id)
  }
  async setAvTransportAudioIn (id = this.id) {
    return this.setAvTransportUri('x-rincon-stream:' + id)
  }
  async setAvTransportGroup (id) {
    return this.setAvTransportUri('x-rincon:' + id)
  }
  async setAvTransportTvIn () {
    return this.setAvTransportUri('x-sonos-htastream:' + this.id + ':spdif')
  }

  static meta (metaData, albumArtUri, description) {
    if (metaData == null || metaData === '') {
      return ''
    }
    let meta = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">'
    meta += `<item id="${metaData.id}" parentID="${metaData.parentId}" restricted="${metaData.restricted}">`
    meta += `<dc:title>${metaData.title}</dc:title>`
    meta += `<upnp:class>${metaData.class}.sonos-favorite</upnp:class>`
    if (albumArtUri != null) {
      meta += `<upnp:albumArtURI>${he.escape(albumArtUri)}</upnp:albumArtURI>`
    }
    if (description != null) {
      meta += `<r:description>${description}</r:description>`
    }
    meta += `<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${metaData.desc._}</desc>`
    meta += '</item></DIDL-Lite>'
    return he.escape(meta)
  }

  async becomeCoordinatorOfStandaloneGroup () {
    return this.post('MediaRenderer', 'AVTransport', 'BecomeCoordinatorOfStandaloneGroup', {
      InstanceID: 0
    })
  }

  async delegateGroupCoordinationTo (id) {
    return this.post('MediaRenderer', 'AVTransport', 'DelegateGroupCoordinationTo', {
      InstanceID: 0,
      NewCoordinator: id,
      RejoinGroup: false
    })
  }

  async getSleepTimer () {
    return (await this.post('MediaRenderer', 'AVTransport', 'GetRemainingSleepTimerDuration', {
      InstanceID: 0
    })).remainingSleepTimerDuration
  }

  async setSleepTimer (value) {
    return this.post('MediaRenderer', 'AVTransport', 'ConfigureSleepTimer', {
      InstanceID: 0,
      NewSleepTimerDuration: value
    })
  }

  // MediaRenderer GroupRenderingControl

  async getGroupVolume () {
    return (await this.post('MediaRenderer', 'GroupRenderingControl', 'GetGroupVolume', {
      InstanceID: 0
    })).currentVolume
  }

  async setGroupVolume (volume) {
    return this.post('MediaRenderer', 'GroupRenderingControl', 'SetGroupVolume', {
      InstanceID: 0,
      DesiredVolume: volume
    })
  }

  async setRelativeGroupVolume (volume) {
    return (await this.post('MediaRenderer', 'RenderingControl', 'SetRelativeGroupVolume', {
      InstanceID: 0,
      Adjustment: volume
    })).newVolume
  }

  async getGroupMute () {
    return (await this.post('MediaRenderer', 'GroupRenderingControl', 'GetGroupMute', {
      InstanceID: 0
    })).currentMute === 1
  }

  async setGroupMute (mute) {
    return this.post('MediaRenderer', 'GroupRenderingControl', 'SetGroupMute', {
      InstanceID: 0,
      DesiredMute: mute ? 1 : 0
    })
  }

  // MediaRenderer RenderingControl

  async getVolume (channel = 'Master') {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetVolume', {
      InstanceID: 0,
      Channel: channel
    })).currentVolume
  }

  async setVolume (volume, channel = 'Master') {
    return this.post('MediaRenderer', 'RenderingControl', 'SetVolume', {
      InstanceID: 0,
      Channel: channel,
      DesiredVolume: volume
    })
  }

  async setRelativeVolume (volume, channel = 'Master') {
    return (await this.post('MediaRenderer', 'RenderingControl', 'SetRelativeVolume', {
      InstanceID: 0,
      Channel: channel,
      Adjustment: volume
    })).newVolume
  }

  async getMute (channel = 'Master') {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetMute', {
      InstanceID: 0,
      Channel: channel
    })).currentMute === 1
  }

  async setMute (mute, channel = 'Master') {
    return this.post('MediaRenderer', 'RenderingControl', 'SetMute', {
      InstanceID: 0,
      Channel: channel,
      DesiredMute: mute ? 1 : 0
    })
  }

  async getBass () {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetBass', {
      InstanceID: 0
    })).currentBass
  }

  async setBass (level) {
    return this.post('MediaRenderer', 'RenderingControl', 'SetBass', {
      InstanceID: 0,
      DesiredBass: level
    })
  }

  async getTreble () {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetTreble', {
      InstanceID: 0
    })).currentTreble
  }

  async setTreble (level) {
    return this.post('MediaRenderer', 'RenderingControl', 'SetTreble', {
      InstanceID: 0,
      DesiredTreble: level
    })
  }

  async getBalance () {
    return (await this.getVolume('RF')) - (await this.getVolume('LF'))
  }

  async setBalance (balance) {
    await this.setVolume(100, balance < 0 ? 'LF' : 'RF')
    return this.setVolume(
      balance < 0 ? 100 - -balance : 100 - balance, balance < 0 ? 'RF' : 'LF'
    )
  }

  async getLoudness (channel = 'Master') {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetLoudness', {
      InstanceID: 0,
      Channel: channel
    })).currentLoudness === 1
  }

  async setLoudness (loudness, channel = 'Master') {
    return this.post('MediaRenderer', 'RenderingControl', 'SetLoudness', {
      InstanceID: 0,
      Channel: channel,
      DesiredLoudness: loudness ? 1 : 0
    })
  }

  async getEq (type) {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetEQ', {
      InstanceID: 0,
      EQType: type
    })).currentLoudness === 1
  }

  async setEq (type, value) {
    return this.post('MediaRenderer', 'RenderingControl', 'SetEQ', {
      InstanceID: 0,
      EQType: type,
      DesiredValue: value ? 1 : 0
    })
  }

  async getNightSound () { return this.getEq('NightMode') }
  async setNightSound (value) { return this.setEq('NightMode', value) }
  async getSpeechEnhancement () { return this.getEq('DialogLevel') }
  async setSpeechEnhancement (value) { return this.setEq('DialogLevel', value) }

  // MediaServer ContentDirectory

  async browse (object = 'FV:2', startingIndex = 0) {
    return this.post('MediaServer', 'ContentDirectory', 'Browse', {
      ObjectID: object,
      BrowseFlag: 'BrowseDirectChildren',
      Filter: 'dc:title,res,dc:creator,upnp:artist,upnp:album,upnp:albumArtURI',
      StartingIndex: startingIndex,
      RequestedCount: 0,
      SortCriteria: ''
    })
  }

  // POST a SOAP action.
  async post (device, service, action, options) {
    this._debugRequest('post(%j, %j, %j, %j)', device, service, action, options)
    let body = '<s:Envelope '
    body += 'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
    body += 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
    body += '<s:Body>'
    body += `<u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">`
    if (options != null) {
      for (const key in options) {
        body += `<${key}>${options[key]}</${key}>`
      }
    }
    body += `</u:${action}></s:Body></s:Envelope>`
    const requestObj = {
      url: (device === 'ZonePlayer' ? '' : '/' + device) + '/' + service + '/Control',
      method: 'POST',
      headers: {
        SOAPaction: `"urn:schemas-upnp-org:service:${service}:1#${action}"`,
        'content-type': 'text/xml; charset="utf8"'
      },
      body: body
    }
    const response = await this._request(requestObj)
    const responseBody = await this._parser.parse(response.body)
    this._debugRequest(
      'post(%j, %j, %j, %j) --> %s', device, service, action, options,
      this._jsonFormatter.format(responseBody)
    )
    return responseBody
  }

  // ***** Device Description **************************************************

  async get (url = '/xml/device_description.xml') {
    this._debugRequest('get(%j)', url)
    if (this._urlCache[url] == null) {
      const requestObj = {
        url: url,
        headers: { 'Connection': 'keep-alive' }
      }
      let response = await this._request(requestObj)
      response = response.body
      if (url.startsWith('/xml/')) {
        response = await this._parser.parse(response)
      }
      this._urlCache[url] = response
    }
    this._debugRequest(
      'get(%j) --> %s', url, this._jsonFormatter.format(this._urlCache[url])
    )
    return Object.assign({}, this._urlCache[url])
  }

  // ***** Communication *******************************************************

  async _request (requestObj) {
    const method = requestObj.method == null ? 'GET' : requestObj.method
    if (requestObj.body != null) {
      this._debugHttp('%s %s %j', method, requestObj.url, requestObj.body)
    } else if (requestObj.headers != null) {
      this._debugHttp('%s %s %j', method, requestObj.url, requestObj.headers)
    } else {
      this._debugHttp('%s %s', method, requestObj.url)
    }
    if (this._props.baseUrl == null) {
      throw new Error(`${this._config.hostname}: not yet initialised`)
    }
    requestObj.baseUrl = this._props.baseUrl
    requestObj.timeout = this._config.timeout
    return new Promise((resolve, reject) => {
      this.emit(
        'request', ++this._requestId, method, requestObj.url,
        requestObj.headers == null || requestObj.headers.SOAPaction == null
          ? undefined
          : requestObj.headers.SOAPaction.split('#')[1].slice(0, -1)
      )
      request(requestObj, (error, response) => {
        if (error) {
          // this._props.lastSeen = null
          return reject(error)
          // return reject(new Error(
          //   `${method} ${requestObj.url}: ${error.message}`
          // ))
        }
        this._props.lastSeen = new Date()
        this.emit('response', this._requestId, response.statusCode)
        if (response.statusCode !== 200) {
          return reject(new Error(
            `${method} ${requestObj.url}: http status ${response.statusCode}`
          ))
        }
        if (requestObj.body != null) {
          this._debugHttp(
            '%s %s %j --> %j', method, requestObj.url, requestObj.body,
            response
          )
        } else {
          this._debugHttp('%s %s --> %j', method, requestObj.url, response)
        }
        return resolve(response)
      })
    })
  }
}

module.exports = ZpClient
