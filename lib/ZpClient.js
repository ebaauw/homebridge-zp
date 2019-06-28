// homebridge-zp/lib/ZpClient.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

// constructor
// - by hostname (entered by user)
// - by UPnP message
// - by zoneGroupState

// handleZoneGroupState
// handleUpnpMessage

'use strict'

const debug = require('debug')
const dns = require('dns')
const events = require('events')
const homebridgeLib = require('homebridge-lib')
const request = require('request')
const ZpXmlParser = require('./ZpXmlParser')

const ipRegExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

let instanceId = 0

class ZpClient extends events.EventEmitter {
  // Return the properties from a zoneGroupState member object.
  static props (member, verbose) {
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
      zone: member.zoneName,
      zoneName: member.zoneName
    }
    // Check for stereo pair.
    if (member.channelMapSet != null) {
      const array = member.channelMapSet.split(';')
      array.forEach((element) => {
        if (element.startsWith(member.uuid)) {
          const channels = element.split(':')[1]
          if (['LF,LF', 'RF,RF'].includes(channels)) {
            props.stereoPair = true
            props.zoneName += ' (L+R)'
            props.channel = channels[0]
          } else {
            props.channel = channels
          }
        }
      })
    }
    // Check for home theatre setup.
    if (member.htSatChanMapSet != null) {
      props.homeTheatre = true
      const array = member.htSatChanMapSet.split(';')
      array.forEach((element) => {
        if (element.startsWith(member.uuid)) {
          const channels = element.split(':')[1]
          if (['LR', 'RR'].includes(channels)) {
            props.role = 'satellite'
            props.zoneName += ' (+LS+RS)'
            props.channel = channels[0] + 'S'
          } else if (channels !== 'LF,RF') {
            props.channel = channels
          } else {
            props.zoneName += ' (+LS+RS)'
          }
        }
      })
    }
    if (props.channel != null) {
      props.name += ' (' + props.channel + ')'
    }
    if (verbose) {
      props._member = member
    }
    return props
  }

  // Return the zones from a zoneGroupState zoneGroups array.
  static topology (zoneGroups, verbose) {
    const zones = {}
    zoneGroups.forEach((group) => {
      group.zoneGroupMembers.forEach((member) => {
        const props = ZpClient.props(member, verbose)
        let zone = zones[member.zoneName]
        if (zone == null) {
          zone = { master: null, name: props.zoneName, zonePlayers: {} }
          zones[member.zoneName] = zone
        }
        if (member.invisible !== 1) {
          zone.master = props.name
        }
        zone.zonePlayers[props.name] = props
        if (member.satellites != null) {
          for (const satellite of member.satellites) {
            const props = ZpClient.props(satellite, verbose)
            zone.zonePlayers[props.name] = props
          }
        }
      })
    })
    return zones
  }

  // Create a new instance of ZpClient.
  constructor (options, zoneGroupMember) {
    super()
    this._instanceId = instanceId++
    this._debug = debug('ZpClient:call:' + instanceId)
    this._debugRequest = debug('ZpClient:request:' + instanceId)
    this._debugHttp = debug('ZpClient:http:' + instanceId)
    this._debug('constructor(%j, %j)', options, zoneGroupMember)

    this._jsonFormatter = new homebridgeLib.JsonFormatter()
    this._parser = new ZpXmlParser()

    this._config = {
      subscriptionTimeout: 30,
      timeout: 15
    }
    const optionParser = new homebridgeLib.OptionParser(this._config)
    optionParser.hostKey()
    optionParser.intKey('timeout', 1, 60) // seconds
    optionParser.intKey('subscriptionTimeout', 1, 1440) // minutes
    optionParser.parse(options)
    this._config.timeout *= 1000 // seconds -> milliseconds
    this._config.subscriptionTimeout *= 60 // minutes -> seconds

    this._device = {}
    this._props = {}
    this._subscriptions = {}
    this._urlCache = {}

    if (zoneGroupMember != null) {
      if (zoneGroupMember['x-rincon-bootseq'] != null) {
        this._props = {
          address: zoneGroupMember.location.split('/')[2].split(':')[0],
          baseUrl: zoneGroupMember.location.split('/').slice(0, 3).join('/'),
          bootSeq: parseInt(zoneGroupMember['x-rincon-bootseq']),
          id: zoneGroupMember.usn.split(':')[1]
        }
      } else {
        this._zoneGroupMember = zoneGroupMember
        this._props = ZpClient.props(zoneGroupMember)
      }
    } else {
      this._props = {}
      if (ipRegExp.test(this._config.hostname)) {
        this._props.address = this._config.hostname
        this._props.baseUrl = 'http://' + this._props.address + ':1400'
      }
    }
    this._debug('constructor(%j, %j) --> %j', options, zoneGroupMember, this._props)
  }

  // ***** Initialisation ******************************************************

  // Properties.
  get address () { return this._props.address }
  get airPlay () { return this._props.airPlay }
  get bootSeq () { return this._props.bootSeq }
  get channel () { return this._props.channel }
  get homeTheatre () { return this._props.homeTheatre }
  get id () { return this._props.id }
  get name () { return this._props.name }
  get role () { return this._props.role }
  get stereoPair () { return this._props.stereoPair }
  get zone () { return this._props.zone }
  get zoneName () { return this._props.zoneName }

  get audioIn () { return this._device.audioIn }
  get balance () { return this.audioIn || this.stereoPair }
  get modelName () { return this._device.modelName }
  get modelNumber () { return this._device.modelNumber }
  get version () { return this._device.version }
  get tvIn () { return this._device.tvIn }

  get lastSeen () { return Math.round((new Date() - this._lastSeen) / 1000) }
  get subscriptions () {
    const a = []
    for (const url in this._subscriptions) {
      a.push(url)
    }
    return a
  }

  async init () {
    this._debug('init()')
    if (this._props.address == null) {
      this._props.address = (await this._lookup())
        .split('.').map((i) => { return parseInt(i) }).join('.')
      this._props.baseUrl = 'http://' + this._props.address + ':1400'
    }
    this._deviceProperties = await this.get()
    this._device = {
      audioIn: false,
      balance: false,
      modelName: this._deviceProperties.device.modelName,
      modelNumber: this._deviceProperties.device.modelNumber,
      version: this._deviceProperties.device.displayVersion,
      tvIn: false
    }
    for (const service of this._deviceProperties.device.serviceList) {
      switch (service.serviceId.split(':')[3]) {
        case 'AudioIn':
          this._device.audioIn = true
          break
        case 'HTControl':
          this._device.tvIn = true
          break
        default:
          break
      }
    }
    if (this._zoneGroupMember == null) {
      this._props.id = this._deviceProperties.device.udn.split(':')[1]
      this._zoneGroupMember = await this._getZone()
      this._props = ZpClient.props(this._zoneGroupMember)
    }
    this._debug('init() --> %j', { props: this._props, device: this._device })
  }

  async getInfo () {
    const response = Object.assign({}, this._props)
    response.audioIn = this.audioIn
    response.balance = this.balance
    response.modelName = this.modelName
    response.modelNumber = this.modelNumber
    response.version = this.version
    response.tvIn = this.tvIn
    return response
  }

  async getTopology (verbose) {
    const zoneGroupsState = await this.getZoneGroupState()
    const zones = ZpClient.topology(zoneGroupsState.zoneGroups, verbose)
    if (verbose) {
      for (const zoneName in zones) {
        const zonePlayers = zones[zoneName].zonePlayers
        for (const zonePlayerName in zonePlayers) {
          const zonePlayer = zonePlayers[zonePlayerName]
          const zpClient = new ZpClient({
            host: zonePlayer.address,
            timeout: this._config.timeout / 1000
          }, zonePlayer._member)
          try {
            await zpClient.init()
            zonePlayer.audioIn = zpClient.audioIn
            zonePlayer.balance = zpClient.balance
            zonePlayer.modelName = zpClient.modelName
            zonePlayer.modelNumber = zpClient.modelNumber
            zonePlayer.version = zpClient.version
            zonePlayer.tvIn = zpClient.tvIn
          } catch (error) {
            this.emit('error', `${zonePlayer.address}: ${error.message}`)
          }
          delete zonePlayer._member
        }
      }
    }
    return zones
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

  // Get the zone from ZoneGroupState.
  async _getZone () {
    const zoneGroupState = await this.getZoneGroupState()
    for (const group of zoneGroupState.zoneGroups) {
      for (const member of group.zoneGroupMembers) {
        if (member.uuid === this._props.id) {
          return member
        }
        if (member.satellites != null) {
          for (const satellite of member.satellites) {
            if (satellite.uuid === this._props.id) {
              return satellite
            }
          }
        }
      }
    }
    return null
  }

  // ***** Event Handling ******************************************************

  async open (zpListener) {
    // check zpListener instance of ZpListener
    this._debug('open()')
    this._zpListener = zpListener
    this._config.callbackUrl = await this._zpListener.addClient(this)
    this.on('event', (device, service, payload) => {
      try {
        this._lastSeen = new Date()
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
    const response = await this._request(requestObj)
    this._debugRequest('unsubscribe(%j) --> %j', url, response)
  }

  _checkBootSeq (bootSeq) {
    if (bootSeq === this._props.bootSeq) {
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
    this.emit('rebooted', oldBootSeq)
  }

  _checkAddress (address) {
    if (address === this._props.address) {
      return
    }
    const oldAddress = this._props.address
    this._props.address = address
    this._props.baseUrl = 'http://' + this._props.address + ':1400'
    this.emit('addressChanged', oldAddress)
  }

  handleUpnpMessage (address, message) {
    this._lastSeen = new Date()
    this._checkAddress(address)
    this._checkBootSeq(parseInt(message['x-rincon-bootseq']))
  }

  handleZoneGroupState (zoneGroupMember) {
    if (this._zoneGroupMember == null) {
      this._zoneGroupMember = zoneGroupMember
      this._props = ZpClient.props(zoneGroupMember)
    }
    this._checkAddress(zoneGroupMember.location.split('/')[2].split(':')[0])
    this._checkBootSeq(zoneGroupMember.bootSeq)
  }

  // ***** Control *************************************************************

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

  async setAvTransportUri (uri, metaData) {
    return this.post('MediaRenderer', 'AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metaData
    })
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

  // MediaRenderer GroupRenderingControl

  async getGroupVolume (channel = 'Master') {
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

  // AlarmClock

  async listAlarms () {
    return this.post('ZonePlayer', 'AlarmClock', 'ListAlarms', {})
  }

  // DeviceProperties

  async getButtonLockState () {
    return (await this.post(
      'ZonePlayer', 'DeviceProperties', 'GetButtonLockState', {}
    )).currentButtonLockState === 'On'
  }

  async setButtonLockState (state) {
    return this.post('ZonePlayer', 'DeviceProperties', 'SetButtonLockState', {
      DesiredLEDState: state ? 'On' : 'Off'
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
    } else {
      this._debugHttp('%s %s', method, requestObj.url)
    }
    requestObj.baseUrl = this._props.baseUrl
    requestObj.timeout = this._config.timeout
    return new Promise((resolve, reject) => {
      request(requestObj, (error, response) => {
        if (error) {
          return reject(new Error(
            `${method} ${requestObj.url}: ${error.message}`
          ))
        }
        if (response.statusCode !== 200) {
          return reject(new Error(
            `${method} ${requestObj.url}: http status ${response.statusCode}`
          ))
        }
        this._lastSeen = new Date()
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
