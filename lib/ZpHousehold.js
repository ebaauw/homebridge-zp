// homebridge-zp/lib/ZpHousehold.js
// Copyright © 2016-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

class ZpHousehold {
  constructor (platform, zpClient) {
    this.platform = platform
    this.household = zpClient.household
  }

  async setAssociated (zpClient) {
    if (zpClient.household !== this.household) {
      throw new SyntaxError(`${zpClient.id} not in ${this.household}`)
    }
    if (this.zpClient != null && zpClient.id !== this.zpClient.id) {
      try {
        await this.zpClient.unsubscribe('/ZoneGroupTopology/Event')
      } catch (error) {}
      if (this.platform.config.alarms) {
        try {
          await this.zpClient.unsubscribe('/AlarmClock/Event')
        } catch (error) {}
      }
      if (this.platform.config.tv) {
        try {
          await this.zpClient.unsubscribe('/MediaServer/ContentDirectory/Event')
        } catch (error) {}
      }
    }
    this.zpClient.removeListener('message', this.onMessage.bind(this))
    this.zpClient = zpClient
    this.zpClient.on('message', this.onMessage.bind(this))
    await this.zpClient.subscribe('/ZoneGroupTopology/Event')
    if (this.platform.config.alarms) {
      await this.zpClient.subscribe('/AlarmClock/Event')
    }
    // if (this.platform.config.tv) {
    //   await this.zpClient.subscribe('/MediaServer/ContentDirectory/Event')
    // }
  }

  async onMessage (message) {
    switch (message.service) {
      case 'ZoneGroupTopology':
        return this.handleZoneGroupTopologyEvent(message.parsedBody)
      case 'AlarmClock':
        return this.handleAlarmClockEvent(message.parsedBody)
      case 'ContentDirectory':
        return this.handleContentDirectoryEvent(message.parsedBody)
      default:
        break
    }
  }

  async handleZoneGroupTopologyEvent (message) {
    for (const group of message.zoneGroups) {
      const coordinator = this.platform.zpClients[group.coordinator]
      if (coordinator == null) {
        continue
      }
      if (coordinator.id !== this.zpClient.id) {
        await coordinator.initTopology(this.zpClient)
      }
      for (const member of group.zoneGroupMembers) {
        const zone = this.platform.zpClients[member.uuid]
        if (zone == null) {
          continue
        }
        if (zone.id !== coordinator.id && zone.id !== this.zpClient.id) {
          try {
            await zone.initTopology(this.zpClient)
          } catch (error) {}
        }
        const master = this.platform.zpMasters[zone.id]
        if (master != null) {
          master.topologyUpdated()
        }
      }
    }
  }

  async handleAlarmClockEvent (message) {
    const alarms = (await this.zpClient.listAlarms()).currentAlarmList
    for (const id in this.platform.zpMasters) {
      const zone = this.platform.zpMasters[id]
      if (zone == null) {
        continue
      }
      zone.alarmListUpdated(alarms)
    }
  }

  async handleContentDirectoryEvent (message) {
    //
  }
}

module.exports = ZpHousehold
