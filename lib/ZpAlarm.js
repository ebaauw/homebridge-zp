// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const xml2js = require('xml2js')

module.exports = {
  ZpAlarm: ZpAlarm
}

let my

// ===== SONOS ALARM ===========================================================

function ZpAlarm (zpAccessory, alarm) {
  this.accessory = zpAccessory
  this.log = this.accessory.log
  this.id = alarm.ID
  my = my || this.accessory.my
  this.parser = new xml2js.Parser()
  // this.log.debug('%s: alarm (%j)', this.accessory.name, alarm)
  if (alarm.ProgramURI === 'x-rincon-buzzer:0') {
    this.name = 'Sonos Chime'
  } else {
    const data = alarm.ProgramMetaData
    if (data) {
      this.parser.parseString(data, function (err, json) {
        // this.log.debug('%s: alarm metadata %j', this.name, json)
        if (!err && json['DIDL-Lite']) {
          this.name = json['DIDL-Lite'].item[0]['dc:title']
        } else {
          this.name = ''
        }
      }.bind(this))
    }
  }
  this.name = this.name + ' (' + alarm.StartTime + ')'
  this.log.debug('%s: alarm %d: %s', this.accessory.name, alarm.ID, this.name)
  this.service = new my.Service.Alarm(zpAccessory.zp.zone + ' alarm ' + this.name, alarm.ID)
  this.service.getCharacteristic(my.Characteristic.Enabled)
    .on('set', this.setEnabled.bind(this))
}

ZpAlarm.prototype.handleAlarm = function (alarm) {
  this.alarm = alarm
  const newValue = alarm.Enabled === '1'
  if (newValue !== this.value) {
    this.log.info(
      '%s: set alarm %s enabled from %s to %s', this.accessory.name,
      this.name, this.value, newValue
    )
    this.value = newValue
    this.service.setCharacteristic(my.Characteristic.Enabled, this.value)
  }
}

ZpAlarm.prototype.setEnabled = function (enabled, callback) {
  if (enabled === this.value) {
    return callback()
  }
  this.log.debug(
    '%s: alarm %s enabled changed from %s to %s', this.accessory.name,
    this.name, this.value, enabled
  )
  this.accessory.alarmClock.SetAlarm(this.id, enabled, function (err, data) {
    if (err) {
      this.log.error('%s: set alarm %s enabled: %s', this.accessory.name, this.name, err)
      return callback(err)
    }
    this.value = enabled
    return callback()
  }.bind(this))
}
