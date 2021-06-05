// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')

const ZpService = require('./ZpService')

class ZpAccessory extends homebridgeLib.AccessoryDelegate {
  constructor (platform, params) {
    super(platform, params)
    this.context.name = params.name
    this.context.id = params.id
    this.context.address = params.address
    this.heartbeatEnabled = true

    this.on('identify', async () => {
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
    })

    this.zpClient = params.zpClient
    if (params.battery != null) {
      this.batteryService = new homebridgeLib.ServiceDelegate.Battery(this, {
        batteryLevel: params.battery.percentage,
        chargingState: params.battery.charging
          ? this.Characteristics.hap.ChargingState.CHARGING
          : this.Characteristics.hap.ChargingState.NOT_CHARGING
      })
      this.checkBattery(params.battery)
      this.zpClient.subscribe('/DeviceProperties/Event')
        .catch((error) => {
          this.error(error)
        })
    }
  }

  handleZonePlayerDevicePropertiesEvent (message) {
    if (message.battery != null) {
      this.checkBattery(message.battery)
    }
  }

  checkBattery (battery) {
    this.debug('battery: %j', battery)
    this.batteryService.values.batteryLevel = battery.percentage
    this.batteryService.values.chargingState = battery.charging
      ? this.Characteristics.hap.ChargingState.CHARGING
      : this.Characteristics.hap.ChargingState.NOT_CHARGING
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
    this.zpClient
      .removeAllListeners('request')
      .removeAllListeners('response')
      .removeAllListeners('error')
      .removeAllListeners('message')
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
        this.vvdebug(
          'request %s: response (headers: %j): %s', response.request.id,
          response.headers, response.body
        )
        this.vdebug(
          'request %s: response: %j', response.request.id, response.parsedBody
        )
        this.debug(
          'request %s: http status %d %s',
          response.request.id, response.statusCode, response.statusMessage
        )
      })
      .on('error', (error) => {
        // FXIME: add request info
        this.warn(error)
      })
      .on('message', (message) => {
        const notify = message.device === 'ZonePlayer'
          ? message.service
          : message.device + '/' + message.service
        this.debug('notify %s/Event', notify)
        this.vdebug('notify %s/Event: %j', notify, message.parsedBody)
        this.vvdebug('notify %s/Event: ', notify, message.body)
        try {
          const f = `handle${message.device}${message.service}Event`
          if (this[f] != null) {
            this[f](message.parsedBody)
          }
        } catch (error) {
          this.error(error)
        }
      })
    this.alarmServices = {}
    this.sonosService = new ZpService.Sonos(this)
    if (this.platform.config.speakers) {
      this.speakerService = new ZpService.Speaker(this)
    }
    if (this.platform.config.leds) {
      this.ledService = new ZpService.Led(this, this.zpClient)
    }
    this.zpClient.subscribe('/GroupManagement/Event')
      .catch((error) => {
        this.error(error)
      })
    if (this.platform.config.alarms) {
      this.notYetInitialised = true
      this.zpClient.subscribe('/AlarmClock/Event')
        .catch((error) => {
          this.error(error)
        })
      return // initialised will be emitted by handleZonePlayerAlarmClockEvent
    }
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  handleZonePlayerGroupManagementEvent (message) {
    this.isCoordinator = message.groupCoordinatorIsLocal === 1
    this.groupId = message.localGroupUuid
    if (this.isCoordinator) {
      this.coordinator = this
      this.sonosService.values.sonosGroup = this.zpClient.zoneName
      for (const member of this.members()) {
        member.coordinator = this
        member.copyCoordinator()
      }
      if (this.speakerService != null) {
        this.speakerService.values.on = false
      }
    } else {
      this.coordinator = this.platform.groupCoordinator(this.groupId)
      if (this.coordinator != null) {
        this.copyCoordinator()
      }
      if (this.speakerService != null) {
        this.speakerService.values.on = true
      }
    }
    this.emit('groupInitialised')
  }

  async handleZonePlayerAlarmClockEvent (message) {
    const alarms = (await this.zpClient.listAlarms()).currentAlarmList
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
    return this.platform.groupMembers(this.groupId)
  }
}

class Slave extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.inheritLogLevel(params.master)
    this.debug('LED accessory')
    this.ledService = new ZpService.Led(this, this.zpClient)
    setImmediate(() => {
      this.emit('initialised')
    })
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
    setImmediate(() => {
      this.emit('initialised')
    })
  }
}

module.exports = ZpAccessory
