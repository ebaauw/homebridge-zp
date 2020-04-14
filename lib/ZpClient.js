// homebridge-zp/lib/ZpClient.js
// Copyright © 2019-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const dns = require('dns')
const events = require('events')
const he = require('he')
const homebridgeLib = require('homebridge-lib')
const ZpListener = require('../lib/ZpListener')
const ZpXmlParser = require('./ZpXmlParser')

const ipRegExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

let instanceId = 0

// Display channels in channelMapSet.
const channelMap = {
  // stereo pair
  'LF,LF': 'L',
  'RF,RF': 'R',
  'SW,SW': 'Sub',
  // home theatre setup
  'LF,RF': '',
  SW: 'Sub',
  LR: 'LS',
  RR: 'RS'
}

class ZpClient extends events.EventEmitter {
  // Return the ids and channels from a channelMapSet.
  static parseChannelMapSet (channelMapSet) {
    const a = channelMapSet.split(';')
    return {
      ids: a.map((elt) => { return elt.split(':')[0] }),
      channels: a.map((elt) => {
        const channel = elt.split(':')[1]
        return channelMap[channel] == null ? channel : channelMap[channel]
      })
    }
  }

  // Return the properties from a zoneGroupState member object.
  static parseMember (member) {
    const props = {
      address: member.location.split('/')[2].split(':')[0],
      baseUrl: member.location.split('/').slice(0, 3).join('/'),
      airPlay: member.airPlayEnabled === 1 ? true : undefined,
      bootSeq: member.bootSeq,
      channel: undefined, // default
      homeTheatre: undefined, // default
      id: member.uuid,
      invisible: member.invisible === 1 ? true : undefined,
      name: member.zoneName,
      role: 'master', // default
      satellites: undefined, // default
      slaves: undefined, // default
      stereoPair: undefined, // default
      zone: member.uuid, // default
      zoneDisplayName: member.zoneName, // default
      zoneName: member.zoneName
    }
    let map
    let slave
    if (member.channelMapSet != null) {
      props.stereoPair = true
      map = ZpClient.parseChannelMapSet(member.channelMapSet)
      slave = 'slave'
    } else if (member.htSatChanMapSet != null) {
      props.homeTheatre = true
      map = ZpClient.parseChannelMapSet(member.htSatChanMapSet)
      slave = 'satellite'
    }
    if (map != null) {
      if (map.ids[0] === props.id) {
        props.role = 'master'
        props[slave + 's'] = map.ids.slice(1)
        props.channel = map.channels[0]
        props.zoneDisplayName += ' (' + map.channels.join('+') + ')'
      } else {
        props.role = slave
        props.zone = map.ids[0]
        for (let id = 1; id < map.ids.length; id++) {
          if (map.ids[id] === props.id) {
            props.channel = map.channels[id]
            break
          }
        }
      }
      if (props.channel !== '') {
        props.name += ' (' + props.channel + ')'
      }
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

    this._props = { id: this._config.id }
    this._subscriptions = {}
    this._urlCache = {}

    this._debug('constructor(%j) --> %j', options, this._config)
  }

  // ***** Initialisation ******************************************************

  // Properties.
  get address () { return this._props.address }

  get airPlay () { return this._props.airPlay }

  get audioIn () { return this._props.audioIn }

  get balance () { return this.audioIn || this.stereoPair ? true : undefined }

  get bootSeq () { return this._props.bootSeq }

  get channel () { return this._props.channel }

  get homeTheatre () { return this._props.homeTheatre }

  get host () { return this._props.host }

  get id () { return this._props.id }

  get invisible () { return this._props.invisible }

  get lastSeen () {
    return this._props.lastSeen == null
      ? null
      : Math.round((new Date() - this._props.lastSeen) / 1000)
  }

  get modelName () { return this._props.modelName }

  get modelNumber () { return this._props.modelNumber }

  get name () { return this._props.name }

  get role () { return this._props.role }

  get satellites () { return this._props.satellites }

  get slaves () { return this._props.slaves }

  get stereoPair () { return this._props.stereoPair }

  get tvIn () { return this._props.tvIn }

  get version () { return this._props.version }

  get zone () { return this._props.zone }

  get zoneDisplayName () { return this._props.zoneDisplayName }

  get zoneName () { return this._props.zoneName }

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
      invisible: this.invisible,
      lastSeen: this.lastSeen,
      modelName: this.modelName,
      modelNumber: this.modelNumber,
      name: this.name,
      role: this.role,
      satellites: this.satellites,
      slaves: this.slaves,
      stereoPair: this.stereoPair,
      tvIn: this.tvIn,
      version: this.version,
      zone: this.zone,
      zoneDisplayName: this.zoneDisplayName,
      zoneName: this.zoneName
    }
  }

  get subscriptions () {
    const a = []
    for (const url in this._subscriptions) {
      a.push(url)
    }
    return a.sort()
  }

  static unflatten (zonePlayers) {
    const zones = {}
    for (const id in zonePlayers) {
      if (zonePlayers[id].role === 'master') {
        zones[id] = Object.assign({}, zonePlayers[id])
        if (zonePlayers[id].slaves != null) {
          zones[id].slaves = []
          for (const slave of zonePlayers[id].slaves) {
            zones[id].slaves.push(zonePlayers[slave])
          }
        }
        if (zonePlayers[id].satellites != null) {
          zones[id].satellites = []
          for (const satellite of zonePlayers[id].satellites) {
            if (zonePlayers[satellite] != null) {
              zones[id].satellites.push(zonePlayers[satellite])
            }
          }
        }
      }
    }
    return zones
  }

  get zones () {
    if (this._zones == null) {
      this._zones = ZpClient.unflatten(this.zonePlayers)
    }
    return this._zones
  }

  get zonePlayers () {
    if (this._zonePlayersByName == null) {
      this._zonePlayersByName = {}
      Object.keys(this._zonesByName).sort().forEach((key) => {
        const id = key.split('|')[1]
        this._zonePlayersByName[id] = Object.assign({}, this._zonePlayers[id])
        if (this._zonePlayers[id].slaves != null) {
          for (const slave of this._zonePlayers[id].slaves) {
            this._zonePlayers[slave].zoneDisplayName = this._zonesByName[key]
            this._zonePlayersByName[slave] = this._zonePlayers[slave]
          }
        }
        if (this._zonePlayers[id].satellites != null) {
          for (const satellite of this._zonePlayers[id].satellites) {
            if (this._zonePlayers[satellite] != null) {
              this._zonePlayersByName[satellite] = this._zonePlayers[satellite]
            }
          }
        }
      })
    }
    return Object.assign({}, this._zonePlayersByName)
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
    this._props.host = this._props.address + ':1400'

    const deviceDescription = await this.get()
    const id = deviceDescription.device.udn.split(':')[1]
    if (this._config.id != null && this._config.id !== id) {
      this.emit('error', new Error('address mismatch'))
      return
    }
    this._config.id = id
    this._props.audioIn = undefined
    this._props.balance = undefined
    this._props.id = id
    this._props.modelName = deviceDescription.device.modelName
    this._props.modelNumber = deviceDescription.device.modelNumber
    this._props.version = deviceDescription.device.displayVersion
    this._props.tvIn = undefined
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

    this._zonePlayers = {}
    this._zonesByName = {}
    let zoneGroupState
    try {
      zoneGroupState = await this.getZoneGroupState()
    } catch (error) {
      if (error.statusCode === 500) {
        const zpListener = new ZpListener()
        this.on('event', (device, service, event) => {
          if (service === 'ZoneGroupTopology') {
            zoneGroupState = event
            this.emit('gotcha')
          }
        })
        await this.open(zpListener)
        await this.subscribe('/ZoneGroupTopology/Event')
        await events.once(this, 'gotcha')
        await this.unsubscribe('/ZoneGroupTopology/Event')
        await this.close()
      } else {
        this.emit('error', error)
      }
    }
    if (zoneGroupState != null) {
      zoneGroupState.zoneGroups.forEach((group) => {
        group.zoneGroupMembers.forEach((member) => {
          const props = ZpClient.parseMember(member)
          if (props.id === this._config.id) {
            Object.assign(this._props, props)
          }
          this._zonePlayers[props.id] = props
          if (props.role === 'master') {
            this._zonesByName[props.zoneName + '|' + props.zone] =
              props.zoneDisplayName
          }
          if (member.satellites != null) {
            const zoneDisplayName = props.zoneDisplayName
            for (const satellite of member.satellites) {
              const props = ZpClient.parseMember(satellite)
              props.zoneDisplayName = zoneDisplayName
              if (props.id === this._config.id) {
                Object.assign(this._props, props)
              }
              this._zonePlayers[props.id] = props
            }
          }
        })
      })
    }
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
    const headers = {
      TIMEOUT: 'Second-' + this._config.subscriptionTimeout
    }
    if (sid == null) {
      headers.CALLBACK = '<' + callbackUrl + '>'
      headers.NT = 'upnp:event'
    } else {
      headers.SID = sid
    }
    const response = await this._request('SUBSCRIBE', url, undefined, headers)
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
    await this._request('UNSUBSCRIBE', url, undefined, { SID: sid })
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
    this._props.host = this._props.address + ':1400'
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

  async setAvTransportQueue (uri, metaData = '') {
    await this.post('MediaRenderer', 'AVTransport', 'RemoveAllTracksFromQueue', {
      InstanceID: 0
    })
    await this.post('MediaRenderer', 'AVTransport', 'AddURIToQueue', {
      InstanceID: 0,
      EnqueuedURI: uri,
      EnqueuedURIMetaData: metaData,
      DesiredFirstTrackNumberEnqueued: 1,
      EnqueueAsNext: 1
    })
    return this.setAvTransportUri('x-rincon-queue:' + this.id + '#0')
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
      RejoinGroup: true
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
    return (await this.post('MediaRenderer', 'GroupRenderingControl', 'SetRelativeGroupVolume', {
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
    let result = await this.post('MediaServer', 'ContentDirectory', 'Browse', {
      ObjectID: object,
      BrowseFlag: 'BrowseDirectChildren',
      Filter: 'dc:title,res,dc:creator,upnp:artist,upnp:album,upnp:albumArtURI',
      StartingIndex: startingIndex,
      RequestedCount: 0,
      SortCriteria: ''
    })
    if (result.result != null) {
      result = result.result
    }
    let container
    if (result.container != null) {
      container = true
      result = result.container
    }
    if (!Array.isArray(result)) {
      if (Object.keys(result).length > 0) {
        result = [result]
      } else {
        result = []
      }
    }
    const obj = {}
    result.forEach((element) => {
      obj[element.title] = {}
      if (container) {
        obj[element.title].browse = element.id
      }
      if (element.description != null) {
        obj[element.title].description = element.description
      }
      if (
        element.resMD != null && element.resMD.class != null &&
        element.resMD.class.startsWith('object.container.')
      ) {
        obj[element.title].container = true
      }
      if (element.res != null && element.res._ != null) {
        obj[element.title].uri = he.escape(element.res._)
      }
      if (element.resMD != null) {
        obj[element.title].meta = ZpClient.meta(
          element.resMD, element.albumArtUri, element.description
        )
      }
    })
    return obj
  }

  // POST a SOAP action.
  async post (device, service, action, options) {
    this._debugRequest('post(%j, %j, %j, %j)', device, service, action, options)
    const url = (device === 'ZonePlayer' ? '' : '/' + device) +
      '/' + service + '/Control'
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
    const headers = {
      SOAPaction: `"urn:schemas-upnp-org:service:${service}:1#${action}"`,
      'content-type': 'text/xml; charset=utf-8'
    }
    const response = await this._request('POST', url, body, headers)
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
    let response = await this._request('GET', url)
    response = response.body
    if (url.startsWith('/xml/')) {
      response = await this._parser.parse(response)
    }
    this._debugRequest(
      'get(%j) --> %s', url, this._jsonFormatter.format(response)
    )
    return response
  }

  // ***** Communication *******************************************************

  async _request (method, resource, body, headers) {
    if (this._client == null) {
      if (this._props.host == null) {
        throw new Error(`${this._config.hostname}: not yet initialised`)
      }
      const options = {
        host: this._props.host,
        keepAlive: true,
        maxSockets: 1,
        timeout: this._config.timeout
      }
      this._client = new homebridgeLib.HttpClient(options)
    }
    const requestId = ++this._requestId
    this.emit(
      'request', requestId, method, resource,
      headers == null || headers.SOAPaction == null
        ? undefined
        : headers.SOAPaction.split('#')[1].slice(0, -1)
    )
    const response = await this._client.request(method, resource, body, headers)
    this._props.lastSeen = new Date()
    this.emit('response', requestId, response.statusCode, response.statusMessage)
    return response
  }
}

module.exports = ZpClient
