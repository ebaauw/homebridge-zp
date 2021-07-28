// homebridge-zp/lib/ZpHousehold.js
// Copyright © 2016-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')

const ZONEPLAYERS_PER_HOUSEHOLD = 32

class ZpHousehold extends homebridgeLib.Delegate {
  constructor (platform, zpClient) {
    super(platform, zpClient.household)
    this.household = zpClient.household
    this.setMaxListeners(ZONEPLAYERS_PER_HOUSEHOLD)
  }

  error (format, ...args) {
    if (typeof format !== 'object' || format.request == null) {
      super.error(format, ...args)
    }
  }

  async setAssociated (zpClient) {
    if (zpClient.household !== this.household) {
      throw new SyntaxError(`${zpClient.id} not in ${this.household}`)
    }
    if (this.zpClient != null && zpClient.id !== this.zpClient.id) {
      try {
        await this.zpClient.unsubscribe('/ZoneGroupTopology/Event')
      } catch (error) { this.error(error) }
      if (this.platform.config.alarms) {
        try {
          await this.zpClient.unsubscribe('/AlarmClock/Event')
        } catch (error) { this.error(error) }
      }
      if (this.platform.config.tv) {
        try {
          await this.zpClient.unsubscribe('/MediaServer/ContentDirectory/Event')
        } catch (error) { this.error(error) }
      }
    }
    this.zpClient.removeListener('message', this.onMessage.bind(this))
    this.log(
      '%s [%s]: associated %s zoneplayer',
      this.zpClient.id, this.zpClient.name, this.zpClient.sonosOs
    )
    this.zpClient = zpClient
    this.zpClient.on('message', this.onMessage.bind(this))
    const timeout = this.platform.config.timeout
    await this.zpClient.subscribe('/ZoneGroupTopology/Event')
    const timer = setTimeout(() => {
      throw new Error(`no ZoneGroupTopology event received in ${timeout}s`)
    }, timeout * 1000)
    await events.once(this, 'topologyUpdated')
    clearTimeout(timer)
    if (this.platform.config.alarms) {
      await this.zpClient.subscribe('/AlarmClock/Event')
      const timer = setTimeout(() => {
        throw new Error(`no AlarmClock event received in ${timeout}s`)
      }, timeout * 1000)
      clearTimeout(timer)
      await events.once(this, 'alarmlistUpdated')
    }
    if (this.platform.config.tv) {
      await this.zpClient.subscribe('/MediaServer/ContentDirectory/Event')
      const timer = setTimeout(() => {
        throw new Error(`no ContentDirectory event received in ${timeout}s`)
      }, timeout * 1000)
      await events.once(this, 'favouritesUpdated')
      clearTimeout(timer)
    }
  }

  async onMessage (message) {
    try {
      const f = `handle${message.device}${message.service}Event`
      if (this[f] != null) {
        await this[f](message.parsedBody)
      }
    } catch (error) {
      this.error(error)
    }
  }

  async handleZonePlayerZoneGroupTopologyEvent (body) {
    try {
      if (body.zoneGroups != null) {
        for (const group of body.zoneGroups) {
          const coordinator = this.platform.zpClients[group.coordinator]
          if (coordinator == null) {
            continue
          }
          if (coordinator.id !== this.zpClient.id) {
            try {
              await coordinator.initTopology(this.zpClient)
            } catch (error) { this.error(error) }
          }
          for (const member of group.zoneGroupMembers) {
            const zone = this.platform.zpClients[member.uuid]
            if (zone == null) {
              continue
            }
            if (zone.id !== coordinator.id && zone.id !== this.zpClient.id) {
              try {
                await zone.initTopology(this.zpClient)
              } catch (error) { this.error(error) }
            }
          }
        }
      }
      if (body.vanishedDevices != null) {
        for (const device of body.vanishedDevices) {
          this.platform.lostZonePlayer(device.uuid)
        }
      }
      this.emit('topologyUpdated')
    } catch (error) { this.error(error) }
  }

  async handleZonePlayerAlarmClockEvent (body) {
    try {
      this.alarmList = (await this.zpClient.listAlarms()).currentAlarmList
      this.emit('alarmlistUpdated')
    } catch (error) { this.error(error) }
  }

  async handleMediaServerContentDirectoryEvent (body) {
    try {
      if (
        body.favoritesUpdateId == null ||
        body.favoritesUpdateId === this.favoritesUpdateId
      ) {
        return
      }
      this.favoritesUpdateId = body.favoritesUpdateId
      this.favourites = await this.zpClient.browse('FV:2')
      this.emit('favouritesUpdated')
    } catch (error) { this.error(error) }
  }
}

module.exports = ZpHousehold
