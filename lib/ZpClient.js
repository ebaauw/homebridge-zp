// homebridge-zp/lib/ZpClient.js
// Copyright © 2019-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const dns = require('dns')
const events = require('events')
const he = require('he')
const homebridgeLib = require('homebridge-lib')
const ZpListener = require('../lib/ZpListener')
const ZpXmlParser = require('./ZpXmlParser')

const ipRegExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

// Display channels in channelMapSet.
const channelMap = {
  // Stereo pair.
  'LF,LF': 'L',
  'RF,RF': 'R',
  'SW,SW': 'Sub',
  // Home theatre setup.
  'LF,RF': '', // master
  SW: 'Sub',
  LR: 'LS',
  RR: 'RS',
  'LR,RR': 'LS+RS' // Connect:Amp as surround.
}

/** ZpClient error.
  * @hideconstructor
  * @extends HttpClient.HttpError
  * @memberof ZpClient
  */
class ZpClientError extends homebridgeLib.HttpClient.HttpError {
  /** The request that caused the error.
    * @type {ZpClient.ZpClientRequest}
    * @readonly
    */
  get request () {}
}

/** Notification from a zone player.
  * @hideconstructor
  * @memberof ZpClient
  */
class ZpClientNotification {
  /** The zone player name.
    * @type {string}
    * @readonly
    */
  get name () {}

  /** The zone player UPnP device that issued the event.
    *
    * This is `ZonePlayer` for top-level services or the actual UPnP device,
    * like `MediaRenderer` or `MediaServer`.
    * services linked
    * @type {string}
    * @readonly
    */
  get device () {}

  /** The zone player service that issued the event.
    * @type {string}
    * @readonly
    */
  get service () {}

  /** The (raw) event body (in XML).
    * @type {string}
    * @readonly
    */
  get body () {}

  /** The (parsed) event body (in JavaScript).
    * @type {*}
    * @readonly
    */
  get parsedBody () {}
}

/** ZpClient request.
  * @hideconstructor
  * @extends HttpClient.HttpRequest
  * @memberof ZpClient
  */
class ZpClientRequest extends homebridgeLib.HttpClient.HttpRequest {
  /** The zone server name.
    * @type {string}
    * @readonly
    */
  get name () {}

  /** The SOAP action of the request.
    * @type {?string}
    * @readonly
    */
  get action () {}

  /** The (raw) response body (in XML).
    * @type {?string}
    * @readonly
    */
  get body () {}

  /** The (parsed) request body (in JavaScript).
    * @type {?*}
    * @readonly
    */
  get parsedBody () {}
}

/** ZpClient response.
  * @hideconstructor
  * @extends HttpClient.HttpResponse
  * @memberof ZpClient
  */
class ZpClientResponse extends homebridgeLib.HttpClient.HttpResponse {
  /** The request that generated the response.
    * @type {ZpClientClient.ZpClientRequest}
    * @readonly
    */
  get request () {}

  /** The (raw) response body (in XML).
    * @type {?string}
    * @readonly
    */
  get body () {}

  /** The (parsed) response body (in JavaScript).
    * @type {?*}
    * @readonly
    */
  get parsedBody () {}
}

/** Client to a Sonos zone player.
  * @extends HttpClient
  */
class ZpClient extends homebridgeLib.HttpClient {
  static get ZpClientError () { return ZpClientError }
  static get ZpClientNotification () { return ZpClientNotification }
  static get ZpClientRequest () { return ZpClientRequest }
  static get ZpClientResponse () { return ZpClientResponse }

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
      battery: member.battery,
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

  /** Create a new instance of a client to a Sonos zone player.
    *
    * @param {object} params - Parameters.
    * @param {!string} params.host - Server hostname and port.
    * @param {?string} params.name - The name of the server.  Defaults to hostname.
    * @param {integer} [params.subscriptionTimeout=30] - Subscription timeout
    * (in minutes).
    * @param {integer} [params.timeout=5] - Request timeout (in seconds).
    */
  constructor (params = {}) {
    const _params = {
      port: 1400,
      subscriptionTimeout: 30,
      timeout: 5
    }
    const optionParser = new homebridgeLib.OptionParser(_params)
    optionParser
      .hostKey('host')
      .stringKey('id')
      .intKey('timeout', 1, 60) // seconds
      .intKey('subscriptionTimeout', 1, 1440) // minutes
      .parse(params)
    _params.subscriptionTimeout *= 60 // minutes -> seconds

    const parser = new ZpXmlParser()
    const options = {
      host: _params.hostname + ':1400',
      keepAlive: true,
      maxSockets: 1,
      timeout: _params.timeout,
      xmlParser: parser.parse.bind(parser)
    }
    super(options)
    /** Emitted when an error has been received from the zone player.
      * @event ZpClient#error
      * @param {ZpClient.ZpClientError} error - The notification.
      */
    /** Emitted when a valid response has been received from the zone player.
      * @event ZpClient#request
      * @param {ZpClient.ZpClientRequest} request - The notification.
      */
    /** Emitted when a request has been sent to the zone player.
      * @event ZpClient#response
      * @param {ZpClient.ZpClientResponse} response - The notification.
      */

    this._params = _params
    this._jsonFormatter = new homebridgeLib.JsonFormatter()
    this._parser = parser
    this._props = { id: _params.id }
    this._subscriptions = {}
    this._urlCache = {}
  }

  // ***** Initialisation ******************************************************

  /** The zone player IP address.
    * @type {string}
    * @readonly
    */
  get address () { return this._props.address }

  /** Whether the zone player supports AirPlay.
    * @type {?boolean}
    * @readonly
    */
  get airPlay () { return this._props.airPlay }

  /** Whether the zone player supports audio in.
    * @type {?boolean}
    * @readonly
    */
  get audioIn () { return this._props.audioIn }

  /** Whether the zone player supports balance.
    * @type {?boolean}
    * @readonly
    */
  get balance () { return this.audioIn || this.stereoPair ? true : undefined }

  /** The battery state of the zone player.
    * @type {?object}
    * @readonly
    */
  get battery () { return this._props.battery }

  /** The zone player boot sequence.
    *
    * This value increases on each zone player reboot.
    * @type {integer}
    * @readonly
    */
  get bootSeq () { return this._props.bootSeq }

  /** The zone player channel when it's part of a stereo pair
    * or home theatre setup.
    * @type {?string}
    * @readonly
    */
  get channel () { return this._props.channel }

  /** Whether the zone player is part of a home theatre setup.
    * @type {?boolean}
    * @readonly
    */
  get homeTheatre () { return this._props.homeTheatre }

  /** The zone player ID.
    *
    * The ID has the format `RINCON_`_xxxxxxxxxxxx_`01400` where _xxxxxxxxxxxx_
    * is the mac address of the zone player.
    * Note that 1400 is the port on the zone player that serves the local
    * SOAP/HTTP API.
    * @type {string}
    * @readonly
    */
  get id () { return this._props.id }

  /** Whether the zone player is invisble (not shown as room in the Sonos app).
    * @type {?boolean}
    * @readonly
    */
  get invisible () { return this._props.invisible }

  /** The time of the last communication from the zone player, i.e. the time
    * the most recent push notification or request response was recevied.
    * @type {Date}
    * @readonly
    */
  get lastSeen () {
    return this._props.lastSeen == null
      ? null
      : Math.round((new Date() - this._props.lastSeen) / 1000)
  }

  /** The zone player model name, e.g. "Sonos Playbar".
    * @type {string}
    * @readonly
    */
  get modelName () { return this._props.modelName }

  /** The zone player model number, e.g. "S9".
    * @type {string}
    * @readonly
    */
  get modelNumber () { return this._props.modelNumber }

  /** The zone player name.
    *
    * This is the zone (room) name,
    * followed by the channel for stereo pairs or satellites,
    * e.g. `Living Room (Sub)`.
    * @type {string}
    * @readonly
    */
  get name () { return this._props.name }

  /** The zone player role in its zone:
    * `master`, `slave`, or `satellite`.
    * @type {string}
    * @readonly
    */
  get role () { return this._props.role }

  /** The IDs of the satellite zone players (for the master zone player in a
    * home theatre setup).
    * @type {?string[]}
    * @readonly
    */
  get satellites () { return this._props.satellites }

  /** The IDs of the slave zone players (for a master zone player in a
    * stereo pair).
    * @type {?string[]}
    * @readonly
    */
  get slaves () { return this._props.slaves }

  /** The zone player OS version: `S1` or `S2`.
    * @type {?string}
    * @readonly
    */
  get sonosOs () { return this._props.sonosOs }

  /** Whether the zone player is part of a stereo pair.
    * @type {?boolean}
    * @readonly
    */
  get stereoPair () { return this._props.stereoPair }

  /** Whether the zone player supports TV input.
    * @type {?boolean}
    * @readonly
    */
  get tvIn () { return this._props.tvIn }

  /** The zone player firmware version.
    * @type {string}
    * @readonly
    */
  get version () { return this._props.version }

  /** The zone player zone.
    *
    * This is the ID of the master zone player of that zone.
    * @type {string}
    * @readonly
    */
  get zone () { return this._props.zone }

  /** The zone player zone (room) display name.
    *
    * This is the zone (room) name, followed by an indication of the
    * slave or satellite channels, e.g. `Living Room (+LS+RS+Sub)`
    * @type {string}
    * @readonly
    */
  get zoneDisplayName () { return this._props.zoneDisplayName }

  /** The zone player zone (room) name, e.g. `Living Room`.
    * @type {string}
    * @readonly
    */
  get zoneName () { return this._props.zoneName }

  /** The zone player info, i.e. the zone player static properties as a single
     * object.
    * @type {object}
    * @readonly
    */
  get info () {
    return {
      address: this.address,
      airPlay: this.airPlay,
      audioIn: this.audioIn,
      balance: this.balance,
      baseUrl: this.baseUrl,
      battery: this.battery,
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
      sonosOs: this.sonosOs,
      stereoPair: this.stereoPair,
      tvIn: this.tvIn,
      version: this.version,
      zone: this.zone,
      zoneDisplayName: this.zoneDisplayName,
      zoneName: this.zoneName
    }
  }

  /** The current subscriptions to the zone player, sorted by UPnP device and
    * service.
    * @type {string[]}
    * @readonly
    */
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

  /**
    */
  get zones () {
    if (this._zones == null) {
      this._zones = ZpClient.unflatten(this.zonePlayers)
    }
    return this._zones
  }

  /**
    */
  get zonePlayers () {
    if (this._zonePlayersByName == null) {
      this._zonePlayersByName = {}
      Object.keys(this._zonesByName).sort().forEach((key) => {
        const id = key.split('|')[1]
        this._zonePlayersByName[id] = Object.assign({}, this._zonePlayers[id])
        if (this._zonePlayers[id].slaves != null) {
          for (const slave of this._zonePlayers[id].slaves) {
            if (this._zonePlayers[slave] != null) {
              this._zonePlayers[slave].zoneDisplayName = this._zonesByName[key]
              this._zonePlayersByName[slave] = this._zonePlayers[slave]
            }
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

  /** Initialise the zpClient instance.
    * Connects to the zone player to retrieve the properties.
    */
  async init () {
    this._props.lastSeen = null
    this._props.address = await this._lookup(this._params.hostname)
    this._params.hostname = this._props.address
    this.host = this._props.address + ':1400'

    const deviceDescription = await this.get()
    const id = deviceDescription.device.udn.split(':')[1]
    if (this._params.id != null && this._params.id !== id) {
      this.emit('error', new Error('address mismatch'))
      return
    }
    this._params.id = id
    this._props.audioIn = undefined
    this._props.balance = undefined
    this._props.id = id
    this._props.modelName = deviceDescription.device.modelName
    this._props.modelNumber = deviceDescription.device.modelNumber
    const majorVersion = deviceDescription.device.displayVersion.split('.')[0]
    this._props.sonosOs = majorVersion <= 11 ? 'S1' : 'S2'
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
          if (props.id === this._params.id) {
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
              if (props.id === this._params.id) {
                Object.assign(this._props, props)
              }
              this._zonePlayers[props.id] = props
            }
          }
        })
      })
    }
  }

  // Resolve hostname to normalised IPv4 address.
  // Note that Sonos zoneplayers only accept HTTP requests to the IP address.
  // A request to the hostname results in an Error 400: Bad request.
  async _lookup (hostname) {
    if (ipRegExp.test(hostname)) {
      // IPv4 address.
      return hostname.split('.').map((i) => { return parseInt(i) }).join('.')
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

  /** Register the zone player for receiving push notifications.
    * @param {ZpListener} listener - The {@link ZpListener} instance to
    * reveive the notifications.
    */
  async open (listener) {
    this._zpListener = homebridgeLib.OptionParser.toInstance(
      'listener', listener, ZpListener
    )
    this._params.callbackUrl = await this._zpListener.addClient(this)
    this._zpListener.on(this.id, async (message) => {
      try {
        message.name = this.name
        if (message.body != null) {
          message.parsedBody = await this._parser.parse(message.body)
        }
        /** Emitted when a push notification has been received from the zone player.
          * @event ZpClient#message
          * @param {ZpClient.ZpClientNotification} message - The message.
          */
        this.emit('message', message)
        this._props.lastSeen = new Date()
      } catch (error) {
        this.emit('error', error)
      }
    })
  }

  /** De-register the zone player for receiving push notifcations.
    */
  async close () {
    for (const url in this._subscriptions) {
      try {
        await this.unsubscribe(url)
      } catch (error) {
        this.emit('error', error)
      }
    }
    if (this._params.callbackUrl != null) {
      await this._zpListener.removeClient(this)
    }
    delete this._params.callbackUrl
  }

  /** Subscribe to push notifications.
    *
    * The subscription will be made with a timeout specified in the constructor
    * through `subscriptionTimeout`.
    * It will be renewed automatically before it expires.
    * In case the zone player reboots, a new subscription will be made
    * automatically.
    *
    * @param {string} url - The UPnP device and service URL, e.g.
    * `/MediaRenderer/AVTransport/Event`.
    */
  async subscribe (url) {
    if (this._params.callbackUrl == null) {
      this.emit('error', new Error('subscribe() before open()'))
    }
    const callbackUrl = this._params.callbackUrl + url
    const headers = {
      TIMEOUT: 'Second-' + this._params.subscriptionTimeout + 30
    }
    let sid
    if (this._subscriptions[url] != null) {
      sid = this._subscriptions[url].sid
      delete this._subscriptions[url].sid
      if (this._subscriptions[url].timeout != null) {
        clearTimeout(this._subscriptions[url].timeout)
        delete this._subscriptions[url].timeout
      }
    }
    if (sid == null) {
      headers.CALLBACK = '<' + callbackUrl + '>'
      headers.NT = 'upnp:event'
    } else {
      headers.SID = sid
    }
    const response = await this._request('SUBSCRIBE', url, undefined, headers)
    const timeout = setTimeout(async () => {
      do {
        try {
          return await this.subscribe(url)
        } catch (error) {
          if (error.statusCode !== 412) {
            await homebridgeLib.timeout(this._params.subscriptionTimeout)
          }
        }
      } while (true)
    }, this._params.subscriptionTimeout * 1000)
    this._subscriptions[url] = {
      sid: response.headers.sid,
      timeout: timeout
    }
  }

  /** Unsubscribe from push notifications.
    * @param {string} url - The UPnP device and service URL, e.g.
    * `/MediaRenderer/AVTransport/Event`.
    */
  async unsubscribe (url) {
    if (this._subscriptions[url] == null) {
      return
    }
    const sid = this._subscriptions[url].sid
    if (this._subscriptions[url].timeout != null) {
      clearTimeout(this._subscriptions[url].timeout)
    }
    delete this._subscriptions[url]
    if (sid != null) {
      await this._request('UNSUBSCRIBE', url, undefined, { SID: sid })
    }
  }

  _checkBootSeq (bootSeq) {
    if (bootSeq === this._props.bootSeq || this._props.bootSeq == null) {
      return
    }
    const oldBootSeq = this._props.bootSeq
    this.emit('rebooted', {
      name: this.name,
      bootSeq: bootSeq,
      oldBootSeq: oldBootSeq
    })
    this._props.bootSeq = bootSeq
    this._urlCache = {}
    for (const url in this._subscriptions) {
      delete this._subscriptions[url].sid
      if (this._subscriptions[url].timeout != null) {
        clearTimeout(this._subscriptions[url].timeout)
        delete this._subscriptions[url].timeout
      }
      this.subscribe(url).catch(() => {})
    }
    this._props.urlCache = {}
  }

  _checkAddress (address) {
    if (address === this._props.address) {
      return
    }
    const oldAddress = this._props.address
    this._props.address = address
    this.host = this._props.address + ':1400'
    this._params.hostname = this._props.address
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

  /** Issue `ListAlarms` action to `AlarmClock` service.
    * @return {object[]} - A list of alarm objects.
    */
  async listAlarms () {
    return this.post('ZonePlayer', 'AlarmClock', 'ListAlarms', {})
  }

  /** Issue `UpdateAlarm` action to `AlarmClock` service.
    * @param {object} alarm - The alarm parameters.
    */
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

  /** Get the zone player button lock state.
    * @return {boolean} - True off zone player buttons are locked.
    */
  async getButtonLockState () {
    return (await this.post(
      'ZonePlayer', 'DeviceProperties', 'GetButtonLockState', {}
    )).currentButtonLockState === 'On'
  }

  /** Set the zone player button lock state.
    * @param {boolean} state - True to lock the buttons, false to unlock them.
    * @return {boolean} - True off zone player buttons are now locked.
    */
  async setButtonLockState (state) {
    return this.post('ZonePlayer', 'DeviceProperties', 'SetButtonLockState', {
      DesiredButtonLockState: state ? 'On' : 'Off'
    })
  }

  /** Get the zone player LED state.
    * @return {boolean} - True iff zone player LED is on.
    */
  async getLedState () {
    return (await this.post(
      'ZonePlayer', 'DeviceProperties', 'GetLEDState', {}
    )).currentLedState === 'On'
  }

  /** Set the zone player LED state.
    * @param {boolean} state - True to turn the LED on, false to turn it off.
    * @return {boolean} - True iff zone player LED is now on.
    */
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

  async getCrossfadeMode () {
    return (await this.post('MediaRenderer', 'AVTransport', 'GetCrossfadeMode', {
      InstanceID: 0
    })).crossfadeMode === 1
  }

  async setCrossfadeMode (mode) {
    return this.post('MediaRenderer', 'AVTransport', 'SetCrossfadeMode', {
      InstanceID: 0,
      CrossfadeMode: mode ? 1 : 0
    })
  }

  async _getPlayMode () {
    return (await this.post('MediaRenderer', 'AVTransport', 'GetTransportSettings', {
      InstanceID: 0
    })).playMode
  }

  async _setPlayMode (repeat, shuffle) {
    let playMode
    if (repeat === 'on') {
      playMode = shuffle ? 'SHUFFLE' : 'REPEAT_ALL'
    } else if (repeat === '1') {
      playMode = shuffle ? 'SHUFFLE_REPEAT_ONE' : 'REPEAT_ONE'
    } else /* if (repeat === 'off') */ {
      playMode = shuffle ? 'SHUFFLE_NOREPEAT' : 'NORMAL'
    }
    return this.post('MediaRenderer', 'AVTransport', 'SetPlayMode', {
      InstanceID: 0,
      NewPlayMode: playMode
    })
  }

  async getRepeat () {
    const playMode = await this._getPlayMode()
    if (playMode === 'REPEAT_ALL' || playMode === 'SHUFFLE') {
      return 'on'
    } else if (playMode === 'REPEAT_ONE' || playMode === 'SHUFFLE_REPEAT_ONE') {
      return '1'
    } else /* if (playMode === 'NORMAL' || playMode === 'SHUFFLE_NOREPEAT') */ {
      return 'off'
    }
  }

  async getShuffle () {
    return ['SHUFFLE_NOREPEAT', 'SHUFFLE_REPEAT_ONE', 'SHUFFLE']
      .includes(await this._getPlayMode())
  }

  async setRepeat (repeat) {
    return this._setPlayMode(repeat, await this.getShuffle())
  }

  async setShuffle (shuffle) {
    return this._setPlayMode(await this.getRepeat(), shuffle)
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
      for (const uri of albumArtUri) {
        meta += `<upnp:albumArtURI>${he.escape(uri)}</upnp:albumArtURI>`
      }
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
    })).currentValue === 1
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

  async getSubEnable () { return this.getEq('SubEnable') }

  async setSubEnable (value) { return this.setEq('SubEnable', value) }

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

  /** Post a SOAP action to the zone player.
    * @param {string} device - The UPnP device, or `ZonePlayer` for the
    * main device, e.g. `MediaRenderer`.
    * @param {string} service - The UPnP sevice, e.g. `AVTransPort`.
    * @param {string} action - The SOAP action, e.g. `Play`.
    * @param {object} options - An object with key/value pairs for the
    * parameters.
    * @returns {?*} - The parsed response body as JavaScript object.
    */
  async post (device, service, action, options) {
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
    const info = {
      action: action,
      parsedBody: options
    }
    return (await this._request('POST', url, body, headers, info)).parsedBody
  }

  /** Get a static url from the zone player.
    * @param {string} [url=/xml/device_description.xml] - The url.
    * @returns {?*} - The parsed response body as JavaScript object.
    */
  async get (url = '/xml/device_description.xml') {
    return (await this._request('GET', url)).parsedBody
  }

  async _request (method, resource, body, headers, info) {
    const response = await super.request(
      method, resource, body, headers, '', info
    )
    this._props.lastSeen = new Date()
    return response
  }
}

module.exports = ZpClient
