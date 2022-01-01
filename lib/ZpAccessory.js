// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2022 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')

// const ZpClient = require('./ZpClient')
const ZpService = require('./ZpService')

class ZpAccessory extends homebridgeLib.AccessoryDelegate {
  constructor (platform, params) {
    super(platform, params)
    this.context.name = params.name
    this.context.id = params.id
    this.context.address = params.address
    this.context.household = params.household
    this.heartbeatEnabled = true
    this.zpClient = params.zpClient
    this.zpHousehold = params.zpHousehold

    this.on('identify', this.identify)
    this.zpHousehold.on('topologyUpdated', this.topologyUpdated.bind(this))
  }

  // Adopt ownership of the ZpClient instance, taking over all event handling.
  // This implies that any 'message` handling by ZpHousehold or ZpAccessory.TV
  // needs to be setup after the ZpAccessory.Master has been created.
  attachZpClient () {
    // if (this.zpClient == null) {
    //   this.zpClient = new ZpClient({
    //     host: this.context.address,
    //     id: this.context.id,
    //     household: this.context.household,
    //     listener: this.platform.listener,
    //     timeout: this.platform.config.timeout
    //   })
    // }
    this.zpClient
      .removeAllListeners('request')
      .removeAllListeners('response')
      .removeAllListeners('error')
      // .removeAllListeners('message')
      .removeAllListeners('rebooted')
      .removeAllListeners('addressChanged')
      // .removeAllListeners()
      .on('request', (request) => {
        this.debug(
          'request %s: %s %s%s',
          request.id, request.method, request.resource,
          request.action == null ? '' : ' ' + request.action
        )
        if (request.parsedBody != null) {
          this.vdebug(
            'request %s: %s %s %j',
            request.id, request.method, request.url, request.parsedBody
          )
          this.vvdebug(
            'request %s: %s %s (headers: %j) %s',
            request.id, request.method, request.url,
            request.headers, request.body
          )
        } else {
          this.vdebug(
            'request %s: %s %s',
            request.id, request.method, request.url
          )
          this.vvdebug(
            'request %s: %s %s (headers: %j)',
            request.id, request.method, request.url, request.headers
          )
        }
      })
      .on('response', (response) => {
        if (response.parsedBody != null) {
          this.vvdebug(
            'request %s: response (headers: %j): %j', response.request.id,
            response.headers, response.body
          )
          this.vdebug(
            'request %s: response: %j', response.request.id, response.parsedBody
          )
        }
        this.debug(
          'request %s: http status %d %s',
          response.request.id, response.statusCode, response.statusMessage
        )
      })
      .on('error', (error) => {
        if (error.request == null) {
          this.error(error)
          return
        }
        if (error.request.id !== this.requestId) {
          if (error.request.body == null) {
            this.log(
              'request %d: %s %s', error.request.id,
              error.request.method, error.request.resource
            )
          } else {
            this.log(
              'request %d: %s %s', error.request.id,
              error.request.method, error.request.resource, error.request.action
            )
          }
          this.requestId = error.request.id
        }
        this.warn(
          'request %d: %s', error.request.id, error
        )
      })
      .on('message', (message) => {
        const notify = message.device === 'ZonePlayer'
          ? message.service
          : message.device + '/' + message.service
        this.vvdebug('notify %s/Event: %s', notify, message.body)
        this.vdebug('notify %s/Event: %j', notify, message.parsedBody)
        this.debug('notify %s/Event', notify)
        try {
          const f = `handle${message.device}${message.service}Event`
          if (this[f] != null) {
            this[f](message.parsedBody)
          }
        } catch (error) {
          this.error(error)
        }
      })
      .on('rebooted', (oldBootSeq) => {
        this.warn('rebooted (%d -> %d)', oldBootSeq, this.zpClient.bootSeq)
      })
      .on('addressChanged', (oldAddress) => {
        this.warn(
          'address changed from %s to %s', oldAddress, this.zpClient.address
        )
      })
      .on('lastSeenUpdated', () => {
        this.updateLastSeen()
      })
  }

  checkBattery () {
    try {
      const battery = this.zpClient.battery
      if (battery.percentage == null || battery.charging == null) {
        return
      }
      this.debug('battery: %j', battery)
      if (this.batteryService == null) {
        this.batteryService = new homebridgeLib.ServiceDelegate.Battery(this, {
          batteryLevel: battery.percentage,
          chargingState: battery.charging
            ? this.Characteristics.hap.ChargingState.CHARGING
            : this.Characteristics.hap.ChargingState.NOT_CHARGING
        })
      }
      this.batteryService.values.batteryLevel = battery.percentage
      this.batteryService.values.chargingState = battery.charging
        ? this.Characteristics.hap.ChargingState.CHARGING
        : this.Characteristics.hap.ChargingState.NOT_CHARGING
    } catch (error) {
      this.error(error)
    }
  }

  async identify () {
    try {
      if (this.blinking) {
        return
      }
      this.blinking = true
      const on = await this.zpClient.getLedState()
      for (let n = 0; n < 10; n++) {
        this.zpClient.setLedState(n % 2 === 0)
        await events.once(this, 'heartbeat')
      }
      await this.zpClient.setLedState(on)
      this.blinking = false
    } catch (error) {
      this.error(error)
    }
  }

  static get Master () { return Master }

  static get Slave () { return Slave }

  static get Tv () { return Tv }
}

class Master extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.debug('Sonos accessory')
    this.alarmServices = {}
    this.sonosService = new ZpService.Sonos(this)
    if (this.platform.config.speakers) {
      this.speakerService = new ZpService.Speaker(this)
    }
    if (this.platform.config.leds) {
      this.ledService = new ZpService.Led(this, this.zpClient)
    }
    this.attachZpClient()
    this.topologyUpdated()
    if (this.platform.config.alarms) {
      this.notYetInitialised = true
      this.zpHousehold.on('alarmListUpdated', this.alarmListUpdated.bind(this))
      this.alarmListUpdated()
      return // 'initialised' will be emitted by alarmListUpdated()
    }
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  updateLastSeen () {
    this.sonosService.values.lastSeen = this.zpClient.lastSeen
    this.sonosService.values.statusFault =
      this.Characteristics.hap.StatusFault.NO_FAULT
  }

  topologyUpdated () {
    this.sonosService.values.sonosGroup = this.zpClient.zoneGroupShortName
    this.isCoordinator = this.zpClient.zoneGroup === this.zpClient.id
    if (this.isCoordinator) {
      this.coordinator = this
      if (this.speakerService != null) {
        this.speakerService.values.on = false
      }
      this.leaving = false
    } else {
      if (this.speakerService != null) {
        this.speakerService.values.on = true
      }
      this.coordinator = this.platform.groupCoordinator(this.zpClient.zoneGroup)
      this.copyCoordinator()
    }
    if (this.zpClient.battery != null) {
      this.checkBattery(this.zpClient.battery)
    }
  }

  alarmListUpdated () {
    const alarms = this.zpHousehold.alarmList
    if (alarms == null) {
      return
    }
    const keys = {}
    for (const alarm of alarms) {
      if (alarm.roomUuid === this.zpClient.id) {
        keys[alarm.id] = true
        const service = this.alarmServices[alarm.id]
        if (service == null) {
          this.alarmServices[alarm.id] = new ZpService.Alarm(this, alarm)
        } else {
          service.alarm = alarm
        }
      }
    }
    for (const key in this.alarmServices) {
      if (!keys[key]) {
        this.log('remove Alarm %s', key)
        this.alarmServices[key].destroy()
        delete this.alarmServices[key]
      }
    }
    if (this.notYetInitialised) {
      delete this.notYetInitialised
      this.emit('initialised')
    }
  }

  // Copy group characteristic values from group coordinator.
  copyCoordinator () {
    const coordinator = this.coordinator
    if (coordinator && coordinator !== this && !this.leaving) {
      this.debug(
        'copy coordinator %s [%s]', this.coordinator.zpClient.id,
        this.coordinator.zpClient.zoneGroupName
      )
      const src = coordinator.sonosService.values
      const dst = this.sonosService.values
      dst.sonosGroup = src.sonosGroup
      dst.on = src.on
      dst.volume = src.volume
      dst.mute = src.mute
      dst.currentTrack = src.currentTrack
      dst.currentTransportActions = src.currentTransportActions
      dst.uri = src.uri
    }
  }

  // Return array of members.
  members () {
    if (!this.isCoordinator) {
      return []
    }
    return this.platform.groupMembers(this.zpClient.id)
  }
}

class Slave extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.inheritLogLevel(params.master)
    this.debug('LED accessory')
    this.context.master = params.master.id
    this.ledService = new ZpService.Led(this, this.zpClient)
    this.attachZpClient()
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  updateLastSeen () {
    this.ledService.values.lastSeen = this.zpClient.lastSeen
    this.ledService.values.statusFault =
      this.Characteristics.hap.StatusFault.NO_FAULT
  }

  topologyUpdated () {
    if (this.zpClient.battery != null) {
      this.checkBattery(this.zpClient.battery)
    }
  }
}

class Tv extends ZpAccessory {
  constructor (platform, params) {
    params.id = platform.config.tvIdPrefix + params.id.slice(6)
    params.category = platform.Accessory.Categories.SPEAKER
    params.externalAccessory = true
    super(platform, params)
    this.inheritLogLevel(params.master)
    this.debug('TV accessory')
    this.tvService = new ZpService.Tv(this, params)
    this.zpClient.on('lastSeenUpdated', () => {
      this.tvService.values.statusFault =
        this.Characteristics.hap.StatusFault.NO_FAULT
    })
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  topologyUpdated () {
    this.tvService.updateGroupInputSource()
  }
}

module.exports = ZpAccessory
