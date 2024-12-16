// homebridge-zp/lib/ZpAccessory/index.js
// Copyright © 2016-2024 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { once } from 'node:events'

import { AccessoryDelegate } from 'homebridge-lib/AccessoryDelegate'
import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'
import 'homebridge-lib/ServiceDelegate/Battery' // TODO: dynamic import

class ZpAccessory extends AccessoryDelegate {
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
        this.batteryService = new ServiceDelegate.Battery(this, {
          batteryLevel: battery.percentage,
          chargingState: battery.charging
            ? this.Characteristics.hap.ChargingState.CHARGING
            : this.Characteristics.hap.ChargingState.NOT_CHARGING,
          lowBatteryThreshold: 20
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
        await once(this, 'heartbeat')
      }
      await this.zpClient.setLedState(on)
      this.blinking = false
    } catch (error) {
      this.error(error)
    }
  }
}

export { ZpAccessory }
