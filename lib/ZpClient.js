// homebridge-zp/lib/ZpClient.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

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
  // Create a new instance of ZpClient.
  constructor (options, zone) {
    super()
    this._instanceId = instanceId++
    this._debug = debug('ZpClient' + this._instanceId)
    this._debug('constructor(%j)', options)

    this._props = {}
    this._subscriptions = {}
    this._urlCache = {}
    this._zone = zone

    this._jsonFormatter = new homebridgeLib.JsonFormatter()
    this._parser = new ZpXmlParser()

    this._config = {
      subscriptionTimeout: 30,
      timeout: 15
    }
    const optionParser = new homebridgeLib.OptionParser(this._config)
    optionParser.stringKey('hostname', true)
    optionParser.intKey('timeout', 1, 60) // seconds
    optionParser.intKey('subscriptionTimeout', 1, 1440) // minutes
    optionParser.parse(options)
    this._config.timeout *= 1000 // seconds -> milliseconds
    this._config.subscriptionTimeout *= 60 // minutes -> seconds

    // this.on('event', (device, service, payload) => {
    //   const f = `handle${device}${service}Event`
    //   if (this[f] != null) {
    //     try {
    //       this[f](payload)
    //     } catch (error) {
    //       this.emit('error', error)
    //     }
    //   }
    // })
  }

  // ***** Initialisation ******************************************************

  // Get zoneplayer properties.
  async init () {
    this._debug('init()')
    this._props.address = (await this._lookup())
      .split('.').map((i) => { return parseInt(i) }).join('.')
    this._props.baseUrl = 'http://' + this._props.address + ':1400'
    this._device = (await this.get()).device
    for (const service of this._device.serviceList) {
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
    if (this._zone == null) {
      this._zone = await this._getZone()
    }
    this._props.type = 'master'
    if (this._zone.channelMapSet != null) {
      if (this._zone.invisible) {
        this._props.type = 'slave'
      }
      const array = this._zone.channelMapSet.split(';')
      for (const element of array) {
        if (element.startsWith(this._zone.uuid)) {
          const channels = element.split(':')[1]
          const array = channels.split(',')
          if (array[0] === array[1]) {
            this._props.stereoPair = true
            this._props.channel = array[0]
          } else {
            this._props.channel = channels
          }
        }
      }
    }
    if (this._zone.htSatChanMapSet != null) {
      this._props.homeTheatre = true
      const array = this._zone.htSatChanMapSet.split(';')
      for (const element of array) {
        if (element.startsWith(this._zone.uuid)) {
          this._props.channel = element.split(':')[1]
          if (['LR', 'RR'].includes(this._props.channel)) {
            this._props.type = 'sattellite'
          }
        }
      }
    }
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
          return reject(new Error('cannot resolve hostname'))
        }
        return resolve(address)
      })
    })
  }

  // Get the zone from ZoneGroupState.
  async _getZone () {
    const uuid = this._device.udn.substr(5)
    const zoneGroupState = await this.getZoneGroupState()
    for (const group of zoneGroupState.zoneGroups) {
      for (const member of group.zoneGroupMembers) {
        if (member.uuid === uuid) {
          return member
        }
        if (member.satellites != null) {
          for (const satellite of member.satellites) {
            if (satellite.uuid === uuid) {
              return satellite
            }
          }
        }
      }
    }
    return null
  }

  // Properties.
  get address () { return this._props.address }
  get airPlay () { return this._zone.airPlayEnabled === 1 }
  get audioIn () { return this._props.audioIn != null }
  get balance () { return this.audioIn || this.stereoPair }
  get channel () { return this._props.channel }
  get homeTheatre () { return this._props.homeTheatre != null }
  get id () { return this._zone.uuid }
  get modelNumber () { return this._device.modelNumber }
  get modelName () { return this._device.modelName }
  get stereoPair () { return this._props.stereoPair != null }
  get type () { return this._props.type }
  get version () { return this._device.displayVersion }
  get zoneName () { return this._zone.zoneName }
  get tvIn () { return this._props.tvIn != null }

  // ***** Event Handling ******************************************************

  async open (zpListener) {
    // check zpListener instance of ZpListener
    this._debug('open()')
    this._zpListener = zpListener
    this._config.callbackUrl = await this._zpListener.addClient(this)
    this._debug('open() => %j', this._config)
  }

  async close () {
    for (const service in this._subscriptions) {
      try {
        await this.unsubscribe(service, this._subscriptions[service])
      } catch (error) {
        this.emit('error', error)
      }
    }
    await this._zpListener.removeClient(this)
  }

  async subscribe (url, sid) {
    this._debug('subscribe(%j, %j)', url, sid)
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
    this._debug('response: %j', response)
    this._subscriptions[url] = response.headers.sid
    setTimeout(() => {
      this.subscribe(url, response.headers.sid)
    }, (this._config.subscriptionTimeout - 30) * 1000)
    this._debug(
      'subscribe(%j, %j) => %s', url, sid || callbackUrl,
      response.headers.sid
    )
  }

  async unsubscribe (url, sid) {
    this._debug('unsubscribe(%j, %j)', url, sid)
    const requestObj = {
      url: url,
      method: 'UNSUBSCRIBE',
      headers: {
        SID: sid
      }
    }
    const response = await this._request(requestObj)
    delete this._subscriptions[url]
    this._debug('unsubscribe(%j, %j) => %j', url, sid, response)
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
      balance < 0 ? 100 + balance : 100 - balance, balance < 0 ? 'RF' : 'LF'
    )
  }

  async getLoudness (channel = 'Master') {
    return (await this.post('MediaRenderer', 'RenderingControl', 'GetLoudness', {
      InstanceID: 0,
      Channel: channel
    })).currentLoudness === 1
  }

  async setLoudness (mute, channel = 'Master') {
    return this.post('MediaRenderer', 'RenderingControl', 'SetLoudness', {
      InstanceID: 0,
      Channel: channel,
      DesiredLoudness: mute ? 1 : 0
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
    this._debug('post(%j, %j, %j, %j)', device, service, action, options)
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
    this._debug('post(%j, %j, %j, %j) => ', device, service, action, options, this._jsonFormatter.format(responseBody))
    return responseBody
  }

  // ***** Device Description **************************************************

  async get (url = '/xml/device_description.xml') {
    this._debug('get(%j)', url)
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
    this._debug('get(%j) => %s', url, this._jsonFormatter.format(this._urlCache[url]))
    return Object.assign({}, this._urlCache[url])
  }

  // ***** Communication *******************************************************

  async _request (requestObj) {
    const method = requestObj.method == null ? 'GET' : requestObj.method
    this._debug('%s %s %j', method, requestObj.url, requestObj.body)
    requestObj.baseUrl = this._props.baseUrl
    requestObj.timeout = this._config.timeout
    return new Promise((resolve, reject) => {
      request(requestObj, (error, response) => {
        if (error) {
          return reject(error)
        }
        if (response.statusCode !== 200) {
          return reject(new Error(
            `http status ${response.statusCode} on ${method} ${requestObj.url}`
          ))
        }
        this._debug('%s %s => %j', method, requestObj.url, response)
        return resolve(response)
      })
    })
  }
}

module.exports = ZpClient
