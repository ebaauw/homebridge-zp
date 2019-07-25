// homebridge-zp/lib/ZpPlatform.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')
const ZpAccessory = require('./ZpAccessory')
const ZpClient = require('./ZpClient')
const ZpListener = require('./ZpListener')

// Constructor for ZpPlatform.  Called by homebridge on load time.
class ZpPlatform extends homebridgeLib.Platform {
  constructor (log, configJson, homebridge) {
    super(log, configJson, homebridge)
    this.on('accessoryRestored', this.accessoryRestored)
    if (configJson == null) {
      return
    }
    this.parseConfigJson(configJson)
    this.unInitialisedZpClients = 0
    this.zpMasters = {} // ZpAccessory.Master delegates by zoneplayer id.
    this.zpSlaves = {} // ZpAccessory.Slave delegates by zonePlayer id.
    this.zpTvs = {} // ZpAccessory.Tv delegates by zonePlayer id.
    this.zpClients = {} // ZpClient by id.
    this.zonePlayers = {} // Reachable ZonePlayers by id.
    this.zones = {} // Reachable zone by zoneName.

    // this.once('heartbeat', this.init)
    this.on('heartbeat', this.heartbeat)
    this.on('shutdown', async () => {
      for (const id in this.zpClients) {
        try {
          await this.zpClients[id].close()
        } catch (error) {
          this.log(error)
        }
      }
    })

    this.upnpConfig({ class: 'urn:schemas-upnp-org:device:ZonePlayer:1' })
    this.on('upnpDeviceAlive', this.handleUpnpMessage)
    this.on('upnpDeviceFound', this.handleUpnpMessage)

    // Setup listener for zoneplayer events.
    this.zpListener = new ZpListener()
    this.zpListener.on('listening', (url) => {
      this.log('listening on %s', url)
    })
    this.zpListener.on('close', (url) => {
      this.log('closed %s', url)
    })
    this.zpListener.on('error', (error) => { this.error(error) })

    const jsonOptions = { noWhiteSpace: false, sortKeys: true }
    this.jsonFormatter = new homebridgeLib.JsonFormatter(jsonOptions)

    this.debug('config: %j', this.config)
    this.debug('SpeakerService: %j', this.config.SpeakerService.UUID)
    this.debug('VolumeCharacteristic: %j', this.config.VolumeCharacteristic.UUID)
  }

  // Reachable ZonePlayers by zonePlayerName
  get zonePlayersByName () {
    const zonePlayersByName = {}
    for (const id in this.zonePlayers) {
      const zonePlayer = this.zonePlayers[id]
      zonePlayersByName[zonePlayer.name] = zonePlayer
    }
    return zonePlayersByName
  }

  // get zones () {
  //   const zonesByName = {}
  //   for (const id in this.zonePlayers) {
  //     const zonePlayer = this.zonePlayers[id]
  //     if (zonePlayer.role === 'master') {
  //       zonesByName[zonePlayer.zoneName] = zonePlayer
  //     }
  //   }
  //   return zonesByName
  // }

  // get zonesByName () {
  //   const zonesByName = {}
  //   for (const id in this.zones) {
  //     const zone = this.zones[id]
  //     zonesByName[zone.name] = zone
  //   }
  //   return zonesByName
  // }

  // Parse config.json into this.config.
  parseConfigJson (configJson) {
    this.config = {
      host: '0.0.0.0',
      nameScheme: '% Sonos',
      port: 0,
      resetTimeout: 500, // milliseconds
      subscriptionTimeout: 30, // minutes
      timeout: 15, // seconds
      tvIdPrefix: 'TV',
      SpeakerService: this.Services.hap.Switch,
      VolumeCharacteristic: this.Characteristics.hap.Volume
    }
    const optionParser = new homebridgeLib.OptionParser(this.config, true)
    optionParser.on('usageError', (message) => {
      this.warn('config.json: %s', message)
    })
    optionParser.stringKey('platform')
    optionParser.stringKey('name')
    optionParser.boolKey('alarms')
    optionParser.boolKey('brightness')
    optionParser.boolKey('excludeAirPlay')
    optionParser.intKey('heartrate', 1, 60)
    optionParser.stringKey('host')
    optionParser.boolKey('leds')
    optionParser.stringKey('nameScheme')
    optionParser.intKey('port', 1, 65535)
    optionParser.intKey('resetTimeout', 1, 60)
    optionParser.enumKey('service')
    optionParser.enumKeyValue('service', 'fan', (value) => {
      this.config.SpeakerService = this.Services.hap.Fan
      this.config.VolumeCharacteristic = this.Characteristics.hap.RotationSpeed
    })
    optionParser.enumKeyValue('service', 'light', (value) => {
      this.config.SpeakerService = this.Services.hap.Lightbulb
      this.config.VolumeCharacteristic = this.Characteristics.hap.Brightness
    })
    optionParser.enumKeyValue('service', 'speaker', (value) => {
      this.config.SpeakerService = this.Services.hap.Speaker
      this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
    })
    optionParser.enumKeyValue('service', 'switch', (value) => {
      this.config.SpeakerService = this.Services.hap.Switch
      this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
    })
    optionParser.boolKey('speakers')
    optionParser.intKey('subscriptionTimeout', 1, 1440) // minutes
    optionParser.intKey('timeout', 1, 60) // seconds
    optionParser.boolKey('tv')
    optionParser.stringKey('tvIdPrefix', true)
    try {
      optionParser.parse(configJson)
      if (this.config.brightness) {
        if (this.config.service === 'speaker' && this.config.service === 'switch') {
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

  // init (beat) {
  //   this.debug('config: %j', this.config)
  //   this.debug('SpeakerService: %j', this.config.SpeakerService.UUID)
  //   this.debug('VolumeCharacteristic: %j', this.config.VolumeCharacteristic.UUID)
  // }

  heartbeat (beat) {
    if (beat % 60 === 30) {
      for (const zonePlayerName of Object.keys(this.zonePlayersByName).sort()) {
        const zpClient = this.zonePlayersByName[zonePlayerName]
        if (zpClient.lastSeen == null) {
          this.lostPlayer(zpClient.id, zpClient.zoneName)
          continue
        }
        const log = (zpClient.lastSeen > 570 ? this.log : this.debug).bind(this)
        log(
          '%s: lastSeen: %js ago at %s, bootSeq: %j', zpClient.name,
          zpClient.lastSeen, zpClient.address, zpClient.bootSeq
        )
        // if (zpClient.lastSeen > 600) {
        //   this.lostPlayer(zpClient.id, zpClient.zoneName)
        // }
      }
    }
  }

  accessoryRestored (className, version, id, name, context) {
    if (context.address != null) {
      this.createZpClient(context.address, id).catch((error) => {
        this.error(error)
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
      await this.createZpClient(address, id)
      this.zpClients[id].handleUpnpMessage(address, message)
    } catch (error) {
      this.error(error)
    }
  }

  // Create new zpClient.
  async createZpClient (address, id) {
    let zpClient = this.zpClients[id]
    if (this.zpClients[id] == null) {
      zpClient = new ZpClient({
        host: address,
        id: id,
        timeout: this.config.timeout
      })
      zpClient.initialised = false
      this.zpClients[id] = zpClient
      zpClient.on('error', (error) => {
        this.error('%s: %s', zpClient.address, error.message)
      })
      zpClient.on('rebooted', (bootSeq) => {
        this.warn(
          '%s: rebooted %j -> %j', zpClient.address, bootSeq, zpClient.bootSeq
        )
      })
      zpClient.on('addressChanged', (oldAddress) => {
        this.warn('%s: now at %s', oldAddress, zpClient.address)
      })
      zpClient.on('event', (device, service, payload) => {
        const f = `handle${device}${service}Event`
        if (this[f] != null) {
          this.debug('%s: %s event', address, service)
          // this.debug('%s: %s event: %j', address, service, payload)
          this[f](zpClient, payload)
        }
      })
    }
    if (!zpClient.initialised) {
      if (zpClient.initialising) {
        await events.once(zpClient, 'init')
        if (zpClient.name == null) {
          throw new Error('cannot initialise zone player')
        }
        return zpClient
      }
      try {
        zpClient.initialising = true
        this.unInitialisedZpClients++
        this.debug('%s: %s: probing (%d jobs)...', address, id, this.unInitialisedZpClients)
        await zpClient.init()
        this.debug(
          '%s: %s: %s: %s (%s) v%s', address, id, zpClient.name,
          zpClient.modelName, zpClient.modelNumber, zpClient.version
        )
        if (this.zonePlayers[zpClient.id] == null) {
          this.topologyChanged = true
          this.zonePlayers[zpClient.id] = zpClient
        }
        if (this.zones[zpClient.zoneName] == null) {
          this.topologyChanged = true
          this.zones[zpClient.zoneName] = {
            master: (zpClient.role === 'master' || zpClient.name === 'BOOST')
              ? zpClient.name : null,
            name: zpClient.zoneName,
            zonePlayers: {}
          }
        }
        if (
          zpClient.role === 'master' &&
          this.zones[zpClient.zoneName].master !== zpClient.id
        ) {
          this.topologyChanged = true
          this.zones[zpClient.zoneName].master = zpClient.name
        }
        if (this.zones[zpClient.zoneName].zonePlayers[zpClient.name] == null) {
          this.topologyChanged = true
          this.zones[zpClient.zoneName].zonePlayers[zpClient.name] = zpClient
        }
        await this.parseZones(zpClient.zones, zpClient.name)
        await zpClient.open(this.zpListener)
        await zpClient.subscribe('/ZoneGroupTopology/Event')
        zpClient.initialised = true
        delete zpClient.initialising
        this.unInitialisedZpClients--
        this.debug(
          '%s: %s: probing done (%d jobs remaining)', address, id,
          this.unInitialisedZpClients
        )
        zpClient.emit('init')
      } catch (error) {
        this.error(error)
        delete zpClient.initialising
        this.unInitialisedZpClients--
        this.debug(
          '%s: %s: probing failed (%d jobs remaining)', address, id,
          this.unInitialisedZpClients
        )
        zpClient.emit('init')
        throw error
      }
    }
    return zpClient
  }

  async parseZones (zones) {
    const jobs = []
    for (const zoneName in zones) {
      const zone = zones[zoneName]
      for (const zonePlayerName in zone.zonePlayers) {
        const zonePlayer = zone.zonePlayers[zonePlayerName]
        if (this.zpClients[zonePlayer.id] == null) {
          jobs.push(
            this.createZpClient(zonePlayer.address, zonePlayer.id)
              .catch((error) => {
                this.error('%s: %j', zonePlayer.address, error)
              })
          )
        }
      }
    }
    for (const job of jobs) {
      await job
    }
    if (this.unInitialisedZpClients === 0 && this.topologyChanged) {
      this.topologyChanged = false
      this.logTopology()
    }
  }

  lostPlayer (id, zoneName) {
    const zpClient = this.zpClients[id]
    if (zpClient == null || this.zonePlayers[id] == null) {
      return
    }
    const zonePlayerName = zpClient.name
    this.debug('%s: %s vanished from %s', zonePlayerName, zpClient.id, zoneName)
    if (this.zones[zoneName] != null) {
      delete this.zones[zoneName].zonePlayers[zonePlayerName]
      if (Object.keys(this.zones[zoneName].zonePlayers).length === 0) {
        this.debug('%s: vanished', zoneName)
        delete this.zones[zoneName]
      }
    }
    delete this.zonePlayers[id]
    zpClient.close().catch((error) => {
      this.error('%s: %s', zpClient.address, error)
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

  logTopology () {
    this.log('found %d zones', Object.keys(this.zones).length)
    for (const zoneName of Object.keys(this.zones).sort()) {
      const zone = this.zones[zoneName]
      let caps
      if (zone.master == null) {
        caps = ' invisible'
      } else {
        const master = zone.zonePlayers[zone.master]
        caps = master.homeTheatre
          ? ' home theatre'
          : master.stereoPair ? ' stereo pair' : ''
      }
      this.log('  %s:%s zone', zone.name, caps)
    }
    this.log('found %d zone players', Object.keys(this.zonePlayers).length)
    for (const zonePlayerName of Object.keys(this.zonePlayersByName).sort()) {
      const zonePlayer = this.zonePlayersByName[zonePlayerName]
      let caps = zonePlayer.role
      caps += zonePlayer.airPlay ? ', airPlay' : ''
      caps += zonePlayer.audioIn ? ', audioIn' : ''
      caps += zonePlayer.tvIn ? ', tvIn' : ''
      this.log(
        '  %s: %s (%s) (%s)', zonePlayer.name,
        zonePlayer.modelName, zonePlayer.modelNumber, caps
      )
    }
    for (const zonePlayerName of Object.keys(this.zonePlayersByName).sort()) {
      const zonePlayer = this.zonePlayersByName[zonePlayerName]
      const a = zonePlayer.modelName.split(' ')
      const params = {
        name: this.config.nameScheme.replace('%', zonePlayer.zoneName),
        id: zonePlayer.id,
        zpClient: this.zpClients[zonePlayer.id],
        address: zonePlayer.address,
        manufacturer: a[0],
        model: a[1] + ' (' + zonePlayer.modelNumber + ')',
        firmware: zonePlayer.version
      }
      if (zonePlayer.role === 'master') {
        if (this.zpMasters[zonePlayer.id] == null) {
          this.zpMasters[zonePlayer.id] = new ZpAccessory.Master(this, params)
        }
        if (this.config.tv && this.zpTvs[zonePlayer.id] == null) {
          const tvParams = Object.assign({
            master: this.zpMasters[zonePlayer.id]
          }, params)
          this.zpTvs[zonePlayer.id] = new ZpAccessory.Tv(this, tvParams)
        }
      } else {
        if (this.config.leds && this.zpSlaves[zonePlayer.id] == null) {
          this.zpSlaves[zonePlayer.id] = new ZpAccessory.Slave(this, params)
        }
      }
    }
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
    this.coordinator = coordinator
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      const service = accessory.sonosService
      if (service != null) {
        service.values.sonosCoordinator = accessory === coordinator
        service.values.platformCoordinatorId = coordinator.zpClient.id
      }
    }
  }
}

module.exports = ZpPlatform
