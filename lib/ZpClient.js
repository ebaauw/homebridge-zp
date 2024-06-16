// homebridge-zp/lib/ZpClient.js
// Copyright © 2019-2024 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { lookup } from 'node:dns/promises'
import { once } from 'node:events'

import he from 'he'

import { HttpClient } from 'homebridge-lib/HttpClient'
import { JsonFormatter } from 'homebridge-lib/JsonFormatter'
import { OptionParser } from 'homebridge-lib/OptionParser'

import { ZpListener } from './ZpListener.js'
import { ZpXmlParser } from './ZpXmlParser.js'

// Basic properties, populated from the device description by init().
const basicProps = Object.freeze([
  'address',
  'audioIn',
  'id',
  'lastSeen',
  'memory',
  'modelName',
  'modelNumber',
  'sonosOs',
  'tvIn',
  'version',
  'zoneName'
])

// Basic properties, populated from the device description by init(), combined
// with advanced properties, populated from the topology by initTopology().
const allProps = Object.freeze([
  'airPlay',
  'balance',
  'battery',
  'bootSeq',
  'channel',
  'homeTheatre',
  'household',
  'invisible',
  'name',
  'role',
  'satellites',
  'slaves',
  'stereoPair',
  'zone',
  'zoneDisplayName',
  'zoneGroup',
  'zoneGroupName',
  'zoneGroupShortName',
  'zonePlayerName'
].concat(basicProps).sort())

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
  'LR,RR': 'LS+RS', // Connect:Amp as surround.
  'LR,LTR': 'LS', // Era 300 as surround
  'RR,RTR': 'RS' // Era 300 as surround
}

/** ZpClient error.
  * @hideconstructor
  * @extends HttpClient.HttpError
  * @memberof ZpClient
  */
class ZpClientError extends HttpClient.HttpError {
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
class ZpClientRequest extends HttpClient.HttpRequest {
  /** The zone player hostname.
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
class ZpClientResponse extends HttpClient.HttpResponse {
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
class ZpClient extends HttpClient {
  static get ZpClientError () { return ZpClientError }
  static get ZpClientNotification () { return ZpClientNotification }
  static get ZpClientRequest () { return ZpClientRequest }
  static get ZpClientResponse () { return ZpClientResponse }

  /** Parse a channel map set, as returned by
    * {@link ZpClient.getZoneGroupState getZoneGroupState()} or by a
    * `zoneGroupTopology` event.
    * @params {string} channelMapSet - The channel map set.
    * @returns {object} map - The parsed channel map set.
    */
  static parseChannelMapSet (channelMapSet) {
    const a = channelMapSet.split(';')
    return {
      ids: a.map((elt) => { return elt.split(':')[0] }),
      channels: a.map((elt) => {
        const channel = elt.split(':')[1]
        return channelMap[channel] ?? channel
      }).sort()
    }
  }

  /** Parse a zoneGroupMembers entry, as returned by
    * {@link ZpClient.getZoneGroupState getZoneGroupState()} or by a
    * `zoneGroupTopology` event.
    * @params {object} member - The`zoneGroupMembers` entry.
    * @returns {object} props - The parsed properties.
    */
  static parseMember (member) {
    const props = {
      address: member.location.split('/')[2].split(':')[0],
      airPlay: member.airPlayEnabled === 1 ? true : undefined,
      battery: member.battery,
      bootSeq: member.bootSeq,
      channel: undefined, // default
      homeTheatre: undefined, // default
      household: undefined, // default
      id: member.uuid,
      invisible: member.invisible === 1 ? true : undefined,
      name: member.zoneName,
      role: 'master', // default
      satellites: undefined, // default
      slaves: undefined, // default
      stereoPair: undefined, // default
      zone: member.uuid, // default
      zoneDisplayName: member.zoneName, // default
      zoneGroup: undefined,
      zoneGroupName: undefined,
      zoneGroupShortName: undefined,
      zoneName: member.zoneName
    }
    let map
    let slave
    let channels
    if (member.channelMapSet != null) {
      props.stereoPair = true
      map = ZpClient.parseChannelMapSet(member.channelMapSet)
      slave = 'slave'
      channels = map.channels
    } else if (member.htSatChanMapSet != null) {
      props.homeTheatre = true
      map = ZpClient.parseChannelMapSet(member.htSatChanMapSet)
      slave = 'satellite'
      channels = map.channels.slice(1)
    }
    if (map != null) {
      if (map.ids[0] === props.id) {
        props.role = 'master'
        props[slave + 's'] = map.ids.slice(1)
        props.channel = map.channels[0]
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
      props.zoneDisplayName += ' (' + channels.join('+').replace('+Sub+Sub', '+Subx2') + ')'
      if (props.channel !== '') {
        props.name += ' (' + props.channel + ')'
      }
    }
    return props
  }

  /** Unflatten a zonePlayers structure.
    * @params {Object} zonePlayers - A flat map of zonePlayer objects,
    * listing the slave and satellite zone players separately.
    * @returns {Object} - A map of nested zonePlayer objects,
    * listing the slave and satellite zone players under the master zone player.
    */
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
    const optionParser = new OptionParser(_params)
    optionParser
      .hostKey('host')
      .stringKey('id')
      .stringKey('household')
      .intKey('timeout', 1, 60) // seconds
      .intKey('subscriptionTimeout', 1, 1440) // minutes
      .instanceKey('listener', ZpListener)
      .parse(params)
    _params.subscriptionTimeout *= 60 // minutes -> seconds

    const parser = new ZpXmlParser()
    const options = {
      host: _params.hostname + ':' + _params.port,
      keepAlive: true,
      maxSockets: 1,
      name: _params.hostname,
      timeout: _params.timeout,
      xmlParser: parser.parse.bind(parser)
    }
    super(options)
    /** Emitted when an error has been received from the zone player.
      * @event ZpClient#error
      * @param {ZpClient.ZpClientError} error - The error.
      */
    /** Emitted when a request has been sent to the zone player.
      * @event ZpClient#request
      * @param {ZpClient.ZpClientRequest} request - The request.
      */
    /** Emitted when a valid response has been received from the zone player.
      * @event ZpClient#response
      * @param {ZpClient.ZpClientResponse} response - The response.
      */

    this._params = _params
    this._jsonFormatter = new JsonFormatter()
    this._parser = parser
    this._props = {
      address: _params.host,
      id: _params.id,
      household: _params.household
    }
    this._subscriptions = {}
  }

  // Error handling.  Only emit 'error' when it wasn't already submitted by
  // _request().
  error (error) {
    if (error.request == null) {
      this.emit('error', error)
    }
  }

  // ***** Initialisation ******************************************************

  /** Initialise the zpClient instance.
    * Looks up the zone player's IP address using DNS (Sonos doens't accept
    * requests issued to the hostname).
    * Connects to the zone player to retrieve the device description,
    * setting the basic properties.
    */
  async init () {
    this._props.lastSeen = null
    this._props.address = (await lookup(this._params.hostname)).address
    this._params.hostname = this._props.address
    this.host = this._props.address + ':1400'

    this._description = await this.get()
    const id = this._description.device.udn.split(':')[1]
    if (this._params.id != null && this._params.id !== id) {
      this.emit('error', new Error('address mismatch'))
      return
    }
    this._params.id = id
    this._props.audioIn = undefined
    this._props.balance = undefined
    this._props.id = id
    this._props.memory = this._description.device.memory
    this._props.modelName = this._description.device.modelName
    this._props.modelNumber = this._description.device.modelNumber
    const majorVersion = this._description.device.displayVersion.split('.')[0]
    this._props.sonosOs = majorVersion <= 11 ? 'S1' : 'S2'
    this._props.version = this._description.device.displayVersion
    this._props.tvIn = undefined
    this._props.zoneName = this._description.device.roomName
    for (const service of this._description.device.serviceList) {
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
    delete this._info
  }

  /** Check whether basic properties have been initialed.
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  checkInit () {
    if (this._description == null) {
      throw new SyntaxError('init() not yet called')
    }
  }

  _handleMessage (message) {
    if (message.service === 'ZoneGroupTopology') {
      this._zoneGroupState = message.parsedBody
      this.emit('gotcha')
    }
  }

  /** Initialise the topology for this zpClient instance.
    * Connects to the zone player to retrieve the a topology,
    * setting the advanced properties, or sets the advanced proporties from
    * the topology retrieved from another zone player.
    * @param {?ZpClient} zpClient - Re-use the topology already retrieved from
    * another zone player.
    */
  async initTopology (zpClient = {}) {
    // this.checkInit()
    this._zonePlayers = {}
    this._zonesByName = {}
    let household = this._props.household
    if (zpClient.zoneGroupState != null) {
      this._zoneGroupState = zpClient.zoneGroupState
      household = zpClient.household
    } else {
      this.on('message', this._handleMessage)
      await this.open()
      await this.subscribe('/ZoneGroupTopology/Event')
      const timeout = setTimeout(() => {
        this.emit('error', new Error(
          `no ZoneGroupTopology event received in ${this._params.timeout}s`
        ))
      }, this._params.timeout * 1000)
      try {
        await once(this, 'gotcha')
      } catch (error) {}
      clearTimeout(timeout)
      await this.close()
      this.removeListener('message', this._handleMessage)
    }
    if (this._zoneGroupState != null) {
      if (this._zoneGroupState.museHouseholdId != null) {
        household = this._zoneGroupState.museHouseholdId.split('.')[0]
      }
      if (household == null) {
        household = await this.getHouseholdId()
      }
      for (const group of this._zoneGroupState.zoneGroups) {
        const ids = []
        let groupName
        const groupMemberNames = []
        for (const member of group.zoneGroupMembers) {
          const props = ZpClient.parseMember(member)
          props.household = household
          props.zoneGroup = group.coordinator
          if (props.id === this._params.id) {
            this._checkAddress(props.address)
            await this._checkBootSeq(props.bootSeq)
            if (props.bootSeq < this._props.bootSeq) {
              props.bootSeq = this._props.bootSeq
            }
            Object.assign(this._props, props)
          }
          this._zonePlayers[props.id] = props
          ids.push(props.id)
          if (props.role === 'master') {
            this._zonesByName[props.zoneName + '|' + props.zone] =
              props.zoneDisplayName
            if (member.uuid === group.coordinator) {
              groupName = props.zoneName
            } else {
              groupMemberNames.push(props.zoneName)
            }
          }
          if (member.satellites != null) {
            const zoneDisplayName = props.zoneDisplayName
            for (const satellite of member.satellites) {
              const props = ZpClient.parseMember(satellite)
              props.household = household
              props.zoneGroup = group.coordinator
              props.zoneDisplayName = zoneDisplayName
              if (props.id === this._params.id) {
                Object.assign(this._props, props)
              }
              this._zonePlayers[props.id] = props
              ids.push(props.id)
            }
          }
        }
        const groupShortName = groupMemberNames.length > 0
          ? groupName + ' + ' + groupMemberNames.length
          : groupName
        groupName = [groupName].concat(groupMemberNames.sort()).join(' + ')
        for (const id of ids) {
          if (id === this._params.id) {
            this._props.zoneGroupName = groupName
            this._props.zoneGroupShortName = groupShortName
          }
          this._zonePlayers[id].zoneGroupName = groupName
          this._zonePlayers[id].zoneGroupShortName = groupShortName
        }
      }
      delete this._info
      delete this._zonePlayersByName
      delete this._zones
    }
  }

  /** Check whether advanced properties have been initialised.
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  checkInitTopology () {
    if (this._zoneGroupState == null) {
      throw new SyntaxError('initTopology() not yet called')
    }
  }

  // ***** Properties **********************************************************

  /** The zone player IP address.
    * @type {string}
    * @readonly
    */
  get address () {
    return this._props.address
  }

  /** Whether the zone player supports AirPlay.
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get airPlay () {
    this.checkInitTopology()
    return this._props.airPlay
  }

  /** Whether the zone player supports audio in.
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get audioIn () {
    this.checkInit()
    return this._props.audioIn
  }

  /** Whether the zone player supports balance.
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get balance () {
    this.checkInitTopology()
    return this.audioIn || this.stereoPair ? true : undefined
  }

  /** The battery state of the zone player.
    * @type {?object}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get battery () {
    this.checkInitTopology()
    return this._props.battery
  }

  /** The zone player boot sequence.
    *
    * This value increases on each zone player reboot.
    * @type {integer}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get bootSeq () {
    this.checkInitTopology()
    return this._props.bootSeq
  }

  /** The zone player channel when it's part of a stereo pair
    * or home theatre setup.
    * @type {?string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get channel () {
    this.checkInitTopology()
    return this._props.channel
  }

  /** The zone player's device description.
    * @type {object}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get description () {
    this.checkInit()
    return this._description
  }

  /** Whether the zone player is part of a home theatre setup.
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get homeTheatre () {
    this.checkInitTopology()
    return this._props.homeTheatre
  }

  /** The household that the zone player is part of.
    * @type {?string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get household () {
    this.checkInitTopology()
    return this._props.household
  }

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

  /** The zone player info, i.e. the zone player static properties as a single
     * object.
    * @type {object}
    * @readonly
    * @throws {SyntaxError} When {@link ZpClient#init init()} hasn't been called.
    */
  get info () {
    this.checkInit()
    if (this._info == null) {
      this._info = {}
      const props = (this._zoneGroupState == null) ? basicProps : allProps
      for (const prop of props) {
        this._info[prop] = this[prop]
      }
    }
    return this._info
  }

  /** Whether the zone player is invisble (not shown as room in the Sonos app).
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get invisible () {
    this.checkInitTopology()
    return this._props.invisible
  }

  /** The timestamp of the last communication from the zone player,
    * i.e. the time when the most recent push notification, request
    * response, or UPnP assouncement was recevied.
    * @type {string}
    * @readonly
    */
  get lastSeen () {
    return this._props.lastSeen == null
      ? 'n/a'
      : String(this._props.lastSeen).substring(0, 24)
  }

  /** The amount of memory in the zone player.
    * @type {integer}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get memory () {
    this.checkInit()
    return this._props.memory
  }

  /** The zone player model name, e.g. "Sonos Playbar".
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get modelName () {
    this.checkInit()
    return this._props.modelName
  }

  /** The zone player model number, e.g. "S9".
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get modelNumber () {
    this.checkInit()
    return this._props.modelNumber
  }

  /** The zone player role in its zone: `master`, `slave`, or `satellite`.
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get role () {
    this.checkInitTopology()
    return this._props.role
  }

  /** The IDs of the satellite zone players (for the master zone player in a
    * home theatre setup).
    * @type {?string[]}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get satellites () {
    this.checkInitTopology()
    return this._props.satellites
  }

  /** The IDs of the slave zone players (for a master zone player in a
    * stereo pair).
    * @type {?string[]}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get slaves () {
    this.checkInitTopology()
    return this._props.slaves
  }

  /** The zone player OS version: `S1` or `S2`.
    * @type {?string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get sonosOs () {
    this.checkInit()
    return this._props.sonosOs
  }

  /** Whether the zone player is part of a stereo pair.
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get stereoPair () {
    this.checkInitTopology()
    return this._props.stereoPair
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

  /** Whether the zone player supports TV input.
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get tvIn () {
    this.checkInit()
    return this._props.tvIn
  }

  /** The zone player firmware version.
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get version () {
    this.checkInit()
    return this._props.version
  }

  /** The zone player zone.
    *
    * This is the ID of the master zone player of that zone.
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zone () {
    this.checkInitTopology()
    return this._props.zone
  }

  /** The zone player zone (room) display name, e.g. "Living Room (+LS+RS+Sub)".
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zoneDisplayName () {
    this.checkInitTopology()
    return this._props.zoneDisplayName
  }

  /** The zone player zone group.
    *
    * This is the ID of the master zone player of the coordinator zone
    * of the zone group.
    *
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zoneGroup () {
    this.checkInitTopology()
    return this._props.zoneGroup
  }

  /** The zone player zone group name, e.g. "Living Room + Bedroom".
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zoneGroupName () {
    this.checkInitTopology()
    return this._props.zoneGroupName
  }

  /** The zone player zone group short name, e.g. "Living Room + 1".
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zoneGroupShortName () {
    this.checkInitTopology()
    return this._props.zoneGroupShortName
  }

  /** The raw zone group state, as returned by
    * {@link ZpClient.getZoneGroupState getZoneGroupState()} or by a
    * `zoneGroupTopology` event.
    * @type {object}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zoneGroupState () {
    this.checkInitTopology()
    return this._zoneGroupState
  }

  /** The zone player zone (room) name, e.g. "Living Room".
    * @type {?boolean}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#init init()} hasn't been called.
    */
  get zoneName () {
    this.checkInit()
    return this._props.zoneName
  }

  /** The zone player name, e.g. `Living Room (Sub)`.
    * @type {string}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zonePlayerName () { return this._props.name }

  /** The cooked zone group state, as a flat map of zonePlayer objects
    * @type {Object}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zonePlayers () {
    this.checkInitTopology()
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

  /** The cooked zone group state, as a nested map of zonePlayer objects
    * @type {Object}
    * @readonly
    * @throws {SyntaxError} - When {@link ZpClient#initTopology initTopology()}
    * hasn't been called.
    */
  get zones () {
    this.checkInitTopology()
    if (this._zones == null) {
      this._zones = ZpClient.unflatten(this.zonePlayers)
    }
    return this._zones
  }

  // ***** Event Handling ******************************************************

  /** Register the zone player for receiving push notifications.
    * @param {ZpListener} listener - The {@link ZpListener} instance to
    * reveive the notifications.
    */
  async open () {
    this._zpListener = this._params.listener
    this._params.callbackUrl = await this._zpListener.addClient(this)
    this._zpListener.on(this.id, async (message) => {
      try {
        await this._updateLastSeen()
        message.name = this.name
        if (message.body != null) {
          message.parsedBody = await this._parser.parse(message.body)
        }
        if (
          message.service === 'ZoneGroupTopology' &&
          message.parsedBody.zoneGroups != null
        ) {
          this._zoneGroupState = message.parsedBody
          await this.initTopology(this)
        }
        /** Emitted when a push notification has been received from the zone player.
          * @event ZpClient#message
          * @param {ZpClient.ZpClientNotification} message - The message.
          */
        this.emit('message', message)
      } catch (error) { this.error(error) }
    })
  }

  /** De-register the zone player for receiving push notifcations.
    */
  async close () {
    for (const url in this._subscriptions) {
      try {
        await this.unsubscribe(url)
      } catch (error) { this.error(error) }
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
      throw new SyntaxError('open() not yet called')
    }
    const callbackUrl = this._params.callbackUrl + url
    const headers = {
      TIMEOUT: 'Second-' + this._params.subscriptionTimeout + 30
    }
    if (this._subscriptions[url] == null) {
      this._subscriptions[url] = {}
    }
    if (this._subscriptions[url].sid == null) {
      headers.CALLBACK = '<' + callbackUrl + '>'
      headers.NT = 'upnp:event'
    } else {
      headers.SID = this._subscriptions[url].sid
      delete this._subscriptions[url].sid
      if (this._subscriptions[url].timeout != null) {
        clearTimeout(this._subscriptions[url].timeout)
        delete this._subscriptions[url].timeout
      }
    }
    try {
      const response = await this._request('SUBSCRIBE', url, undefined, headers)
      this._subscriptions[url].sid = response.headers.sid
    } catch (error) {
      if (error.statusCode === 412) {
        return this.subscribe(url)
      }
      this._checkSubscriptions = true
      this.error(error)
      return
    }
    this._subscriptions[url].timeout = setTimeout(async () => {
      try {
        await this.subscribe(url)
      } catch (error) {
        this._checkSubscriptions = true
        this.error(error)
      }
    }, this._params.subscriptionTimeout * 1000)
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
      try {
        await this._request('UNSUBSCRIBE', url, undefined, { SID: sid })
      } catch (error) { this.error(error) }
    }
  }

  async _checkBootSeq (bootSeq) {
    if (this._props.bootSeq == null) {
      this._props.bootSeq = bootSeq
    }
    if (bootSeq <= this._props.bootSeq) {
      return
    }
    const oldBootSeq = this._props.bootSeq
    this._props.bootSeq = bootSeq
    await this.init()
    for (const url in this._subscriptions) {
      delete this._subscriptions[url].sid
      if (this._subscriptions[url].timeout != null) {
        clearTimeout(this._subscriptions[url].timeout)
        delete this._subscriptions[url].timeout
      }
      try {
        await this.subscribe(url)
      } catch (error) { this.error(error) }
    }
    /** Emitted when the zone player has rebooted.
      * @event ZpClient#rebooted
      * @param {integer} oldBootSeq - The old
      * {@link ZpClient#bootSeq bootSeq} value.
      */
    this.emit('rebooted', oldBootSeq)
  }

  _checkAddress (address) {
    if (address === this._props.address) {
      return
    }
    const oldAddress = this._props.address
    this._props.address = address
    this.host = this._props.address + ':1400'
    this._params.hostname = this._props.address
    /** Emitted when the zone player has a new IP address.
      * @event ZpClient#addressChanged
      * @param {string} oldAddress - The old
      * {@link ZpClient#address address} value.
      */
    this.emit('addressChanged', oldAddress)
  }

  async _updateLastSeen () {
    if (this._reSubscribing) {
      return
    }
    this._reSubscribing = true
    this._props.lastSeen = new Date()
    if (this._checksubscriptions) {
      for (const url in this._subscriptions) {
        if (this._subscriptions[url].sid == null) {
          try {
            await this.subscribe(url)
          } catch (error) { this.error(error) }
        }
      }
    }
    this.emit('lastSeenUpdated')
    this._reSubscribing = false
  }

  /** Handle an mDNS or UPnP message that a zone player is alive.
    *
    * - Update {@link ZpClient#lastSeen lastSeen}.
    * - Update {@link ZpClient#address address} when the zone player's IP
    * address has changed.
    * - Call {@link ZpClient#init init()} when {@link ZpClient#bootSeq bootSeq}
    * has changed.
    * @param {object} message - The message.
    * @param {string} message.id - The zone player ID.
    * @param {string} message.address - The zone player IP address.
    * @param {string} message.household - The zone player household.
    * @param {interget} message.bootseq - The zone player boot sequence.
    */
  async handleAliveMessage (message) {
    if (this._props.id != null && message.id !== this._props.id) {
      return
    }
    if (this._props.household !== message.household) {
      this._props.household = message.household
    }
    this._checkAddress(message.address)
    await this._checkBootSeq(message.bootseq)
    await this._updateLastSeen()
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

  async getHouseholdId () {
    return (await this.post(
      'ZonePlayer', 'DeviceProperties', 'GetHouseholdID', {}
    )).currentHouseholdId
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
    })).currentValue
  }

  async setEq (type, value) {
    return this.post('MediaRenderer', 'RenderingControl', 'SetEQ', {
      InstanceID: 0,
      EQType: type,
      DesiredValue: value
    })
  }

  async getNightSound () { return (await this.getEq('NightMode')) === 1 }

  async setNightSound (value) { return this.setEq('NightMode', value ? 1 : 0) }

  async getSpeechEnhancement () { return (await this.getEq('DialogLevel')) === 1 }

  async setSpeechEnhancement (value) { return this.setEq('DialogLevel', value ? 1 : 0) }

  async getSurroundEnable () { return (await this.getEq('SurroundEnable')) === 1 }

  async setSurroundEnable (value) { return this.setEq('SurroundEnable', value ? 1 : 0) }

  async getTvLevel () { return this.getEq('SurroundLevel') }

  async setTvLevel (value) { return this.setEq('SurroundLevel', value) }

  async getMusicLevel () { return this.getEq('MusicSurroundLevel') }

  async setMusicLevel (value) { return this.setEq('MusicSurroundLevel', value) }

  async getMusicPlaybackFull () { return (await this.getEq('SurroundMode')) === 1 }

  async setMusicPlaybackFull (value) { return this.setEq('SurroundMode', value ? 1 : 0) }

  async getHeightLevel () { return this.getEq('HeightChannelLevel') }

  async setHeightLevel (value) { return this.setEq('HeightChannelLevel', value) }

  async getSubEnable () { return (await this.getEq('SubEnable')) === 1 }

  async setSubEnable (value) { return this.setEq('SubEnable', value ? 1 : 0) }

  async getSubLevel () { return this.getEq('SubGain') }

  async setSubLevel (value) { return this.setEq('SubGain', value) }

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
      action,
      parsedBody: options
    }
    const response = await this._request('POST', url, body, headers, info)
    await this._updateLastSeen()
    return response.parsedBody
  }

  /** Get a static url from the zone player.
    * @param {string} [url=/xml/device_description.xml] - The url.
    * @returns {?*} - The parsed response body as JavaScript object.
    */
  async get (url = '/xml/device_description.xml') {
    const response = await this._request('GET', url)
    await this._updateLastSeen()
    return response.parsedBody
  }

  async _request (method, resource, body, headers, info) {
    const response = await super.request(
      method, resource, body, headers, '', info
    )
    return response
  }
}

export { ZpClient }
