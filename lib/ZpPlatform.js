// homebridge-zp/lib/ZpPlatform.js
// Copyright © 2016-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')
const ZpAccessory = require('./ZpAccessory')
const ZpClient = require('./ZpClient')
const ZpListener = require('./ZpListener')

let zpListener

// Constructor for ZpPlatform.  Called by homebridge on load time.
class ZpPlatform extends homebridgeLib.Platform {
  constructor (log, configJson, homebridge) {
    super(log, configJson, homebridge)
    this.on('accessoryRestored', this.accessoryRestored)
    this.parseConfigJson(configJson)
    this.unInitialisedZpClients = 0
    this.households = {} // Households by household id.
    this.zpClients = {} // ZpClient by zoneplayer id.
    this.zpMasters = {} // ZpAccessory.Master delegates by zoneplayer id.
    this.zpSlaves = {} // ZpAccessory.Slave delegates by zonePlayer id.
    this.zpTvs = {} // ZpAccessory.Tv delegates by zonePlayer id.
    this.coordinators = {} // ZpAccessory.Master coordinator per household id.

    // this.once('heartbeat', this.init)
    this.on('heartbeat', this.heartbeat)
    this.on('shutdown', async () => {
      for (const id in this.zpClients) {
        try {
          await this.zpClients[id].close()
        } catch (error) {
          this.warn(error)
        }
      }
    })

    this.upnpConfig({ class: 'urn:schemas-upnp-org:device:ZonePlayer:1' })
    this.on('upnpDeviceAlive', this.handleUpnpMessage)
    this.on('upnpDeviceFound', this.handleUpnpMessage)

    // Setup listener for zoneplayer events.
    if (zpListener == null) {
      zpListener = new ZpListener(this.config.port)
      zpListener
        .on('listening', (url) => { this.log('listening on %s', url) })
        .on('close', (url) => { this.log('closed %s', url) })
        .on('error', (error) => { this.warn(error) })
    }
    this.listener = zpListener

    const jsonOptions = { noWhiteSpace: false, sortKeys: true }
    this.jsonFormatter = new homebridgeLib.JsonFormatter(jsonOptions)

    this.debug('config: %j', this.config)
    this.debug('SpeakerService: %j', this.config.SpeakerService.UUID)
    this.debug('VolumeCharacteristic: %j', this.config.VolumeCharacteristic.UUID)
  }

  // Parse config.json into this.config.
  parseConfigJson (configJson) {
    this.config = {
      nameScheme: '% Sonos',
      maxFavourites: 96,
      port: 0,
      resetTimeout: 500, // milliseconds
      subscriptionTimeout: 30, // minutes
      timeout: 15, // seconds
      tvIdPrefix: 'TV',
      SpeakerService: this.Services.hap.Switch,
      VolumeCharacteristic: this.Characteristics.hap.Volume
    }
    const optionParser = new homebridgeLib.OptionParser(this.config, true)
    optionParser
      .on('userInputError', (message) => {
        this.warn('config.json: %s', message)
      })
      .stringKey('platform')
      .stringKey('name')
      .boolKey('alarms')
      .boolKey('brightness')
      .boolKey('excludeAirPlay')
      .intKey('heartrate', 1, 60)
      .boolKey('leds')
      .stringKey('nameScheme')
      .intKey('maxFavourites', 16, 96)
      .intKey('port', 0, 65535)
      .intKey('resetTimeout', 1, 60)
      .enumKey('service')
      .enumKeyValue('service', 'fan', () => {
        this.config.SpeakerService = this.Services.hap.Fan
        this.config.VolumeCharacteristic = this.Characteristics.hap.RotationSpeed
      })
      .enumKeyValue('service', 'light', () => {
        this.config.SpeakerService = this.Services.hap.Lightbulb
        this.config.VolumeCharacteristic = this.Characteristics.hap.Brightness
      })
      .enumKeyValue('service', 'speaker', () => {
        this.config.SpeakerService = this.Services.hap.Speaker
        this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
      })
      .enumKeyValue('service', 'switch', () => {
        this.config.SpeakerService = this.Services.hap.Switch
        this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
      })
      .boolKey('speakers')
      .intKey('subscriptionTimeout', 1, 1440) // minutes
      .intKey('timeout', 1, 60) // seconds
      .boolKey('tv')
      .stringKey('tvIdPrefix', true)
    try {
      optionParser.parse(configJson)
      if (this.config.port <= 1024) {
        this.config.port = 0
      }
      if (this.config.brightness) {
        if (this.config.service === 'speaker' || this.config.service === 'switch') {
          this.config.VolumeCharacteristic = this.Characteristics.hap.Brightness
        } else {
          this.warn(
            'config.json: ignoring "brightness" for "service": "%s"',
            this.config.service
          )
        }
      }
      this.config.subscriptionTimeout *= 60 // minutes -> seconds
    } catch (error) {
      this.fatal(error)
    }
  }

  heartbeat (beat) {
    if (beat % 300 === 30) {
      if (Object.keys(this.households).length === 0) {
        this.warn('no zone players found')
        return
      }
      for (const householdId in this.households) {
        const associatedZpClient = this.households[householdId]
        for (const id in associatedZpClient.zonePlayers) {
          const zpClient = this.zpClients[id]
          if (zpClient == null) {
            continue
          }
          if (zpClient.lastSeen == null) {
            this.lostPlayer(zpClient.id, zpClient.zoneName)
            continue
          }
          const log = (zpClient.lastSeen > 570 ? this.log : this.debug).bind(this)
          log(
            '%s [%s]: lastSeen: %js ago at %s, bootSeq: %j', zpClient.id,
            zpClient.name, zpClient.lastSeen, zpClient.address, zpClient.bootSeq
          )
          // if (zpClient.lastSeen > 600) {
          //   this.lostPlayer(zpClient.id, zpClient.zoneName)
          // }
        }
      }
    }
  }

  accessoryRestored (className, version, id, name, context) {
    if (context.address != null) {
      this.createZpClient(id, context.address).catch((error) => {
        this.warn(error)
      })
    }
  }

  async handleUpnpMessage (address, message) {
    const id = message.usn.split(':')[1]
    if (message.st != null) {
      this.debug('upnp: found %s at %s', id, address)
    } else {
      // this.debug('upnp: %s is alive at %s', id, address)
    }
    try {
      await this.createZpClient(id, address)
      this.zpClients[id].handleUpnpMessage(address, message)
    } catch (error) {
      this.error(error)
    }
  }

  // Create new zpClient.
  async createZpClient (id, address) {
    let zpClient = this.zpClients[id]
    if (zpClient != null && zpClient.address !== address) {
      this.warn(
        '%s [%s]: now at %s', id,
        zpClient.name == null ? zpClient.address : zpClient.name, address
      )
      delete this.zpClients[id]
    }
    if (zpClient != null) {
      return
    }
    zpClient = new ZpClient({
      host: address,
      id: id,
      listener: this.listener,
      timeout: this.config.timeout
    })
    this.zpClients[id] = zpClient
    zpClient
      .on('request', (request) => {
        this.debug(
          '%s [%s]: request %s: %s %s%s', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          request.id, request.method, request.resource,
          request.action == null ? '' : ' ' + request.action
        )
      })
      .on('response', (response) => {
        this.debug(
          '%s [%s]: request %s: status %d %s', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          response.request.id, response.statusCode, response.statusMessage
        )
      })
      .on('error', (error) => {
        if (error.request == null) {
          this.warn(
            '%s [%s]: %s', zpClient.id,
            zpClient.name == null ? zpClient.address : zpClient.name,
            error
          )
          return
        }
        if (error.request.body == null) {
          this.log(
            '%s [%s]: request %d: %s %s', zpClient.id,
            zpClient.name == null ? zpClient.address : zpClient.name,
            error.request.id, error.request.method, error.request.resource
          )
        } else {
          this.log(
            '%s [%s]: request %d: %s %s', zpClient.id,
            zpClient.name == null ? zpClient.address : zpClient.name,
            error.request.id, error.request.method, error.request.resource,
            error.request.action
          )
        }
        this.warn(
          '%s [%s]: request %s: %s', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          error.request.id, error
        )
      })
      .on('message', (message) => {
        const notify = message.device === 'ZonePlayer'
          ? message.service
          : message.device + '/' + message.service
        this.debug(
          '%s [%s]: notify %s/Event', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          notify
        )
        this.vdebug(
          '%s [%s]: notify %s/Event: %j', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          notify, message.parsedBody
        )
        this.vvdebug(
          '%s [%s]: notify %s/Event: ', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          notify, message.body
        )
      })
      .on('rebooted', (bootSeq) => {
        this.warn(
          '%s [%s]: rebooted %j -> %j', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          bootSeq, zpClient.bootSeq
        )
      })
      .on('addressChanged', (oldAddress) => {
        this.warn(
          '%s [%s]: now at %s', zpClient.id,
          zpClient.name == null ? oldAddress : zpClient.name,
          zpClient.address
        )
        this.createZpClient(id, zpClient.address).catch((error) => {
          this.error(error)
        })
      })
    try {
      this.unInitialisedZpClients++
      this.debug(
        '%s [%s]: probing (%d jobs)...',
        id, address, this.unInitialisedZpClients
      )
      await zpClient.init()
      this.debug(
        '%s [%s]: %s: %s (%s) v%s, reached over local address %s',
        id, address, zpClient.zoneName,
        zpClient.modelName, zpClient.modelNumber, zpClient.version,
        zpClient.localAddress
      )
      this.topologyChanged = true
      await zpClient.initTopology()
      await this.parseZones(zpClient)
      if (!zpClient.invisible) {
        if (
          this.households[zpClient.household] == null || (
            zpClient.battery != null &&
            this.households[zpClient.household].battery != null
          )
        ) {
          this.households[zpClient.household] = zpClient
        }
      }
      await zpClient.open(zpListener)
    } catch (error) {
      this.error('%s [%s]: %s', id, address, error)
    }
    this.unInitialisedZpClients--
    this.debug(
      '%s [%s]: probing done (%d jobs remaining)',
      zpClient.id, zpClient.name, this.unInitialisedZpClients
    )
    if (this.unInitialisedZpClients === 0 && this.topologyChanged) {
      this.topologyChanged = false
      this.logTopology()
    }
  }

  async parseZones (zpClient) {
    const jobs = []
    for (const id in zpClient.zonePlayers) {
      if (this.zpClients[id] == null) {
        const zonePlayer = zpClient.zonePlayers[id]
        if (zonePlayer == null) {
          continue
        }
        jobs.push(
          this.createZpClient(zonePlayer.id, zonePlayer.address)
            .catch((error) => {
              this.error('%s [%s]: %s', zonePlayer.id, zonePlayer.address, error)
            })
        )
      }
    }
    for (const job of jobs) {
      await job
    }
  }

  lostPlayer (id, zoneName) {
    const zpClient = this.zpClients[id]
    if (zpClient == null) {
      return
    }
    this.debug('%s: %s vanished from %s', zpClient.name, zpClient.id, zoneName)
    this.topologyChanged = true
    zpClient.close().catch((error) => {
      this.error('%s [%s]: %s', zpClient.id, zpClient.address, error)
    })
    this.logTopology()
  }

  handleZonePlayerZoneGroupTopologyEvent (zpClient, zoneGroupState) {
    if (zoneGroupState.vanishedDevices != null) {
      for (const zonePlayer of zoneGroupState.vanishedDevices) {
        this.lostPlayer(zonePlayer.uuid, zonePlayer.zoneName)
      }
    }
    if (zoneGroupState.zoneGroups != null) {
      this.parseZones(zoneGroupState.zoneGroups).catch((error) => {
        this.error(error)
      })
    }
  }

  async logTopology () {
    if (Object.keys(this.households).length === 0) {
      this.warn('no zone players found')
      this.debug('initialised')
      this.emit('initialised')
      return
    }
    const jobs = []
    this.log('found %d households', Object.keys(this.households).length)
    for (const householdId in this.households) {
      const associatedZpClient = this.households[householdId]
      this.log(
        '%s: %s [%s]: associated %s zone player', householdId,
        associatedZpClient.id, associatedZpClient.name, associatedZpClient.sonosOs
      )
      try {
        await associatedZpClient.subscribe('/ZoneGroupTopology/Event')
      } catch (error) {}
      const zonePlayers = associatedZpClient.zonePlayers
      const zones = associatedZpClient.zones
      const nZones = Object.keys(zones).length
      this.log(
        '%s: found %d %s zone players in %d zones', householdId,
        Object.keys(zonePlayers).length, associatedZpClient.sonosOs, nZones
      )
      let i = 0
      let j = 0
      let nZonePlayers
      for (const id in zonePlayers) {
        const zpClient = this.zpClients[id]
        await zpClient.initTopology(associatedZpClient)
        if (zpClient.role === 'master') {
          i++
          j = 0
          let caps = ''
          if (zpClient.invisible) {
            // Sonos Boost or Sonos Bridge
            caps = ' (invisible)'
          }
          this.log(
            '%s %s%s', i < nZones ? '├─' : '└─',
            zpClient.zoneDisplayName, caps
          )
          nZonePlayers = 1
          nZonePlayers += zpClient.slaves != null ? zpClient.slaves.length : 0
          // Fixme: handle missing satellites
          nZonePlayers += zpClient.satellites != null
            ? zpClient.satellites.length
            : 0
        }
        j++
        let caps = zpClient.role
        caps += zpClient.airPlay ? ', airPlay' : ''
        caps += zpClient.audioIn ? ', audioIn' : ''
        caps += zpClient.tvIn ? ', tvIn' : ''
        this.log(
          '%s %s %s [%s]: %s (%s) (%s)', i < nZones ? '│ ' : '  ',
          j < nZonePlayers ? '├─' : '└─', zpClient.id,
          zpClient.name, zpClient.modelName, zpClient.modelNumber, caps
        )
      }
      for (const id in zonePlayers) {
        const zpClient = this.zpClients[id]
        const a = zpClient.modelName.split(' ')
        const params = {
          name: zpClient.zoneName,
          id: zpClient.id,
          zpClient: zpClient,
          address: zpClient.address,
          manufacturer: a[0],
          model: a[1] + ' (' + zpClient.modelNumber + ')',
          firmware: zpClient.version,
          battery: zpClient.battery
        }
        if (zpClient.channel != null && zpClient.channel !== '') {
          params.name += ' ' + zpClient.channel
        }
        const expose = !(this.config.excludeAirPlay && zpClient.airPlay) &&
          !zpClient.invisible
        if (zpClient.role === 'master') {
          if (expose && this.zpMasters[zpClient.id] == null) {
            this.zpMasters[zpClient.id] = new ZpAccessory.Master(this, params)
            jobs.push(events.once(this.zpMasters[zpClient.id], 'initialised'))
          }
          if (expose && this.config.tv && this.zpTvs[zpClient.id] == null) {
            const tvParams = Object.assign({
              master: this.zpMasters[zpClient.id]
            }, params)
            delete tvParams.battery
            this.zpTvs[zpClient.id] = new ZpAccessory.Tv(this, tvParams)
            jobs.push(events.once(this.zpTvs[zpClient.id], 'initialised'))
          }
        } else { // zonePlayer.role !== 'master'
          if (this.config.leds && this.zpSlaves[zpClient.id] == null) {
            const slaveParams = Object.assign({
              master: this.zpMasters[zpClient.zone]
            }, params)
            this.zpSlaves[zpClient.id] = new ZpAccessory.Slave(this, slaveParams)
            jobs.push(events.once(this.zpSlaves[zpClient.id], 'initialised'))
          }
        }
      }
    }
    for (const job of jobs) {
      await job
    }
    this.debug('initialised')
    this.emit('initialised')
  }

  // Return coordinator for group.
  groupCoordinator (groupId) {
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      if (accessory.isCoordinator && accessory.groupId === groupId) {
        return accessory
      }
    }
    return null
  }

  // Return array of members for group.
  groupMembers (groupId) {
    const members = []
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      if (!accessory.isCoordinator && accessory.groupId === groupId) {
        members.push(accessory)
      }
    }
    return members
  }

  // Set coordinator zpAccessory as default coordinator
  setPlatformCoordinator (coordinator) {
    const household = coordinator.zpClient.household
    this.coordinators[household] = coordinator
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      const service = accessory.sonosService
      if (service != null && accessory.zpClient.household === household) {
        service.values.sonosCoordinator = accessory === coordinator
        service.values.platformCoordinatorId = coordinator.zpClient.id
      }
    }
  }
}

module.exports = ZpPlatform
