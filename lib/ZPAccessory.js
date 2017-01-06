// homebridge-zp/lib/ZPAccessory.js
// (C) 2016-2017, Erik Baauw
//
// Homebridge plug-in for Sonos ZonePlayer.

"use strict";

const events = require("events");
const request = require("request");
const SonosModule = require("sonos");
const util = require("util");
const xml2js = require("xml2js");

module.exports = {
  setHomebridge: setHomebridge,
  ZPAccessory: ZPAccessory
};

let Accessory;
let Service;
let Characteristic;

function setHomebridge(Homebridge) {
  Accessory = Homebridge.platformAccessory;
  Service = Homebridge.hap.Service;
  Characteristic = Homebridge.hap.Characteristic;
}

// ===== SONOS ACCESSORY =======================================================

// Constructor for ZPAccessory.
function ZPAccessory(platform, zp) {
  this.name = zp.zone + " Sonos";
  this.uuid_base = zp.id;
  this.zp = zp;
  this.platform = platform;
  this.subscriptions = {};
  this.state = {
    group: {},
    zone: {}
  };
  this.log = this.platform.log;
  this.parser = new xml2js.Parser();

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "homebridge-zp")
    .setCharacteristic(Characteristic.Model, this.zp.model)
    .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);

  this.groupService = new this.platform.service(this.name, "group");
  this.groupService.addOptionalCharacteristic(Characteristic.On);
  this.groupService.getCharacteristic(Characteristic.On)
    .on("get", function(callback) {callback(null, this.state.group.on);}.bind(this))
    .on("set", this.setGroupOn.bind(this));
  this.groupService.addOptionalCharacteristic(this.platform.characteristic);
  this.groupService.getCharacteristic(this.platform.characteristic)
    .on("get", function(callback) {callback(null, this.state.group.volume);}.bind(this))
    .on("set", this.setGroupVolume.bind(this));
  this.groupService.addOptionalCharacteristic(Characteristic.Mute);
  this.groupService.getCharacteristic(Characteristic.Mute)
    .on("get", function(callback) {callback(null, this.state.group.mute);}.bind(this))
    .on("set", this.setGroupMute.bind(this));
  this.groupService.addOptionalCharacteristic(Characteristic.Track);
  this.groupService.getCharacteristic(Characteristic.Track)
    .on("get", function(callback) {callback(null, this.state.group.track);}.bind(this));
  this.groupService.addOptionalCharacteristic(Characteristic.ZoneGroup);
  this.groupService.getCharacteristic(Characteristic.ZoneGroup)
    .on("get", function(callback) {callback(null, this.state.group.name);}.bind(this));

  this.zoneService = new this.platform.service(this.name + " Zone", "zone");
  this.zoneService.addOptionalCharacteristic(Characteristic.On);
  this.zoneService.getCharacteristic(Characteristic.On)
    .on("get", function(callback) {callback(null, this.state.zone.on);}.bind(this))
    .on("set", this.setZoneOn.bind(this));
  this.zoneService.addOptionalCharacteristic(this.platform.characteristic);
  this.zoneService.getCharacteristic(this.platform.characteristic)
    .on("get", function(callback) {callback(null, this.state.zone.volume);}.bind(this))
    .on("set", this.setZoneVolume.bind(this));
  this.zoneService.addOptionalCharacteristic(Characteristic.Mute);
  this.zoneService.getCharacteristic(Characteristic.Mute)
    .on("get", function(callback) {callback(null, this.state.zone.mute);}.bind(this))
    .on("set", this.setZoneMute.bind(this));

  this.avTransport = new SonosModule.Services.AVTransport(this.zp.host, this.zp.port);
  this.groupRenderingControl = new SonosModule.Services.GroupRenderingControl(this.zp.host, this.zp.port);

  this.on("GroupManagement", this.handleGroupManagementEvent);
  this.on("AVTransport", this.handleAVTransportEvent);
  this.on("RenderingControl", this.handleRenderingControlEvent);
  this.on("GroupRenderingControl", this.handleGroupRenderingControlEvent);

  this.createSubscriptions();
}

util.inherits(ZPAccessory, events.EventEmitter);

// Called by homebridge to initialise a static accessory.
ZPAccessory.prototype.getServices = function() {
  if (this.platform.zonegroups) {
    return [this.groupService, this.zoneService, this.infoService];
  }
  return [this.groupService, this.infoService];
};

// Return array of members.
ZPAccessory.prototype.members = function() {
  if (!this.isCoordinator) {
    return [];
  }
  return this.platform.groupMembers(this.group);
};

// Copy group characteristic values from group coordinator.
ZPAccessory.prototype.copyCoordinator = function() {
  const coordinator = this.coordinator;
  if (coordinator && coordinator !== this) {
    coordinator.becomePlatformCoordinator();
    this.log.debug("%s: copy characteristics from %s", this.name, coordinator.name);
    if (this.state.group.on !== coordinator.state.group.on) {
      this.log.debug("%s: set member on from %s to %s", this.name,
                     this.state.group.on, coordinator.state.group.on);
      this.state.group.on = coordinator.state.group.on;
      this.groupService.setCharacteristic(Characteristic.On, this.state.group.on);
    }
    if (this.state.group.volume !== coordinator.state.group.volume) {
      this.log.debug("%s: set member group volume from %s to %s", this.name,
                     this.state.group.volume, coordinator.state.group.volume);
      this.state.group.volume = coordinator.state.group.volume;
      this.groupService.setCharacteristic(this.platform.characteristic, this.state.group.volume);
    }
    if (this.state.group.mute !== coordinator.state.group.mute) {
      this.log.debug("%s: set member group mute from %s to %s", this.name,
                     this.state.group.mute, coordinator.state.group.mute);
      this.state.group.mute = coordinator.state.group.mute;
      this.groupService.setCharacteristic(Characteristic.Mute, this.state.group.mute);
    }
    if (this.state.group.track !== coordinator.state.group.track) {
      this.log.debug("%s: set member track from %s to %s", this.name,
                     this.state.group.track, coordinator.state.group.track);
      this.state.group.track = coordinator.state.group.track;
      this.groupService.setCharacteristic(Characteristic.Track, this.state.group.track);
    }
    if (this.state.group.name !== coordinator.state.group.name) {
      this.log.debug("%s: set member group from %s to %s", this.name,
      this.state.group.name, coordinator.state.group.name);
      this.state.group.name = coordinator.state.group.name;
      this.groupService.setCharacteristic(Characteristic.ZoneGroup, this.state.group.name);
    }
  }
};

ZPAccessory.prototype.becomePlatformCoordinator = function() {
  if (!this.platform.coordinator) {
    this.log("%s: platform coordinator", this.name);
    this.platform.coordinator = this;
    this.state.zone.on = true;
    this.zoneService.setCharacteristic(Characteristic.On, this.state.zone.on);
  }
};

ZPAccessory.prototype.quitPlatformCoordinator = function() {
  if (this.platform.coordinator === this) {
    this.platform.coordinator = null;
  }
  this.state.zone.on = false;
  this.zoneService.setCharacteristic(Characteristic.On, this.state.zone.on);
};

// ===== SONOS EVENTS ==========================================================

ZPAccessory.prototype.createSubscriptions = function() {
  this.subscribe("", "GroupManagement", function(err) {
    if (err) {
      this.log.error("%s: subscribe to GroupManagement events: %s", this.name, err);
    }
    setTimeout(function () {
      // Give homebridge-zp some time to setup groups.
      for (const member of this.members()) {
        member.coordinator = this;
        member.log.info("%s: member of group %s", member.name, member.coordinator.name);
        member.copyCoordinator();
      }
      this.subscribe("MediaRenderer", "AVTransport", function(err) {
        if (err) {
          this.log.error("%s: subscribe to AVTransport events: %s", this.name, err);
        }
        this.subscribe("MediaRenderer", "RenderingControl", function(err) {
          if (err) {
            this.log.error("%s: subscribe to RenderingControl events: %s", this.name, err);
          }
          this.subscribe("MediaRenderer", "GroupRenderingControl", function(err) {
            if (err) {
              this.log.error("%s: subscribe to GroupRenderingControl events: %s", this.name, err);
            }
          }.bind(this));
        }.bind(this));
      }.bind(this));
    }.bind(this), 200);
  }.bind(this));
};

ZPAccessory.prototype.handleGroupManagementEvent = function(data) {
  this.log.debug("%s: GroupManagement event", this.name);
  this.isCoordinator = data.GroupCoordinatorIsLocal === "1";
  this.group = data.LocalGroupUUID;
  if (this.isCoordinator) {
    this.state.group.name = this.name;
    this.groupService.setCharacteristic(Characteristic.ZoneGroup, this.state.group.name);
    this.coordinator = this;
    this.log.info("%s: coordinator for group %s", this.name, this.coordinator.name);
    for (const member of this.members()) {
      member.coordinator = this;
      member.copyCoordinator();
    }
    if (this.platform.coordinator !== this) {
      this.state.zone.on = false;
      this.zoneService.setCharacteristic(Characteristic.On, this.state.zone.on);
    }
  } else {
    this.coordinator = this.platform.groupCoordinator(this.group);
    if (this.coordinator) {
      this.log.info("%s: member of group %s", this.name, this.coordinator.name);
      this.copyCoordinator();
    }
    this.state.zone.on = true;
    this.zoneService.setCharacteristic(Characteristic.On, this.state.zone.on);
  }
};

ZPAccessory.prototype.handleAVTransportEvent = function(data) {
  this.log.debug("%s: AVTransport event", this.name);
  this.parser.parseString(data.LastChange, function(err, json) {
    if (err) {
      return;
    }
    let on = this.state.group.on;
    let track = this.state.group.track;
    const event = json.Event.InstanceID[0];
    if (event.TransportState) {
      on = event.TransportState[0].$.val === "PLAYING";
    }
    if (event.CurrentTrackMetaData) {
      const data = event.CurrentTrackMetaData[0].$.val;
      if (data) {
        this.parser.parseString(data, function(err, json) {
          if (!err && json["DIDL-Lite"]) {
            const type = json["DIDL-Lite"].item[0].res[0]._;
            switch (type.split(":")[0]) {
              case "x-rincon-stream": // Line in input.
              track = json["DIDL-Lite"].item[0]["dc:title"][0]; // source
              break;
              case "x-sonos-htastream": // SPDIF TV input.
              track = "TV";
              break;
              case "x-sonosapi-stream": // Radio stream.
              track = json["DIDL-Lite"].item[0]["r:streamContent"][0]; // info
              if (track === "") {
                if (event["r:EnqueuedTransportURIMetaData"]) {
                  const data = event["r:EnqueuedTransportURIMetaData"][0].$.val;
                  if (data) {
                    this.parser.parseString(data, function(err, json) {
                      if (json["DIDL-Lite"]) {
                        track = json["DIDL-Lite"].item[0]["dc:title"][0];	// station
                      }
                    }.bind(this));
                  }
                }
              }
              break;
              case "x-file-cifs":		    // Library song.
              case "x-sonos-spotify":		// Spotify song.
              /* falls through */
              default:
              track = json["DIDL-Lite"].item[0]["dc:title"][0]; // song
              // track = json["DIDL-Lite"].item[0]["dc:creator"][0]; // artist
              // track = json["DIDL-Lite"].item[0]["upnp:album"][0]; // album
              // track = json["DIDL-Lite"].item[0].res[0].$.duration; // duration
              break;
            }
          }
        }.bind(this));
      }
    }
    if (on !== this.state.group.on) {
      this.log.info("%s: on changed from %s to %s", this.name, this.state.group.on, on);
      this.state.group.on = on;
      this.groupService.setCharacteristic(Characteristic.On, this.state.group.on);
      for (const member of this.members()) {
        member.copyCoordinator(this);
      }
    }
    if (track !== this.state.group.track &&
      track !== "ZPSTR_CONNECTING" && track !== "ZPSTR_BUFFERING") {
        this.log.info("%s: track changed from %s to %s", this.name,
        this.state.group.track, track);
        this.state.group.track = track;
        this.groupService.setCharacteristic(Characteristic.Track, this.state.group.track);
        for (const member of this.members()) {
          member.copyCoordinator();
        }
      }
    }.bind(this));
  };

  ZPAccessory.prototype.handleRenderingControlEvent = function(data) {
    this.log.debug("%s: RenderingControl event", this.name);
    this.parser.parseString(data.LastChange, function(err, json) {
      const event = json.Event.InstanceID[0];
      if (event.Volume) {
        const volume = Number(event.Volume[0].$.val);
        if (volume !== this.state.zone.volume) {
          this.log.info("%s: volume changed from %s to %s", this.name, this.state.zone.volume, volume);
          this.state.zone.volume = volume;
          this.zoneService.setCharacteristic(this.platform.characteristic, this.state.zone.volume);
        }
      }
      if (event.Mute) {
        const mute = event.Mute[0].$.val === "1" ? true : false;
        if (mute !== this.state.zone.mute) {
          this.log.info("%s: mute change from %s to %s", this.name, this.state.zone.mute, mute);
          this.state.zone.mute = mute;
          this.zoneService.setCharacteristic(Characteristic.Mute, this.state.zone.mute);
        }
      }
    }.bind(this));
  };

  ZPAccessory.prototype.handleGroupRenderingControlEvent = function(json) {
    this.log.debug("%s: GroupRenderingControl event", this.name);
    if (json.GroupVolume) {
      const volume = Number(json.GroupVolume);
      if (volume !== this.state.group.volume) {
        this.log.info("%s: group volume changed from %s to %s", this.name, this.state.group.volume, volume);
        this.state.group.volume = volume;
        this.groupService.setCharacteristic(this.platform.characteristic, this.state.group.volume);
        for (const member of this.members()) {
          member.copyCoordinator(this);
        }
      }
    }
    if (json.GroupMute) {
      const mute = json.GroupMute === "1" ? true : false;
      if (mute !== this.state.group.mute) {
        this.log.info("%s: group mute changed from %s to %s", this.name, this.state.group.mute, mute);
        this.state.group.mute = mute;
        this.groupService.setCharacteristic(Characteristic.Mute, this.state.group.mute);
        for (const member of this.members()) {
          member.copyCoordinator(this);
        }
      }
    }
  };

  // ===== HOMEKIT EVENTS ==================================================================

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setZoneOn = function(on, callback) {
    on = on ? true : false;
    if (this.state.zone.on === on) {
      return callback();
    }
    this.log.info("%s: set zone on from %s to %s", this.name, this.state.zone.on, on);
    this.state.zone.on = on;
    if (on) {
      const coordinator = this.platform.coordinator;
      if (coordinator) {
        return this.join(coordinator, callback);
      }
      this.becomePlatformCoordinator();
      return callback();
    } else {
      if (this.platform.coordinator === this) {
        this.platform.coordinator = null;
      }
      if (this.isCoordinator) {
        const newCoordinator = this.members()[0];
        if (newCoordinator) {
          newCoordinator.becomePlatformCoordinator();
          return this.abandon(newCoordinator, callback);
        }
        return callback();
      }
      return this.leave(callback);
    }
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setZoneVolume = function(volume, callback) {
    if (this.state.zone.volume === volume) {
      return callback();
    }
    this.log.info("%s: set zone volume from %s to %s", this.name, this.state.zone.volume, volume);
    this.zp.setVolume(volume + "", function(err, data) {
      if (err) {
        this.log.error("%s: setVolume: %s", this.name, err);
        return callback(err);
      }
      this.state.zone.volume = volume;
      return callback();
    }.bind(this));
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setZoneMute = function(mute, callback) {
    mute = mute ? true : false;
    if (this.state.zone.mute === mute) {
      return callback();
    }
    this.log.info("%s: set zone mute from %s to %s", this.name, this.state.zone.mute, mute);
    this.zp.setMuted(mute, function(err, data) {
      if (err) {
        this.log.error("%s: setMuted", this.name, err);
        return callback(err);
      }
      this.state.zone.mute = mute;
      return callback();
    }.bind(this));
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setGroupOn = function(on, callback) {
    on = on ? true : false;
    if (this.state.group.on === on) {
      return callback();
    }
    if (!this.isCoordinator) {
      return this.coordinator.setGroupOn(on, callback);
    }
    this.log.info("%s: set group on from %s to %s", this.name, this.state.group.on, on);
    if (on) {
      this.log.debug("%s: play", this.name);
      this.zp.play(function(err, success) {
        if (err || !success) {
          this.log.error("%s: play: %s", this.name, err);
          return callback(err);
        }
        return callback();
      }.bind(this));
    } else {
      this.log.debug("%s: stop", this.name);
      this.zp.stop(function(err, success) {
        if (err || !success) {
          this.log.error("%s: stop: %s", this.name, err);
          return callback(err);
        }
        return callback();
      }.bind(this));
    }
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setGroupVolume = function(volume, callback) {
    if (this.state.group.volume === volume) {
      return callback();
    }
    if (!this.isCoordinator) {
      return this.coordinator.setGroupVolume(volume, callback);
    }
    this.log.info("%s: set group volume from %s to %s", this.name, this.state.group.volume, volume);
    const args = {
      InstanceID: 0,
      DesiredVolume: volume + ""
    };
    this.groupRenderingControl._request('SetGroupVolume', args, function(err, status) {
      if (err) {
        this.log.error("%s: set group volume", this.name, err);
        return callback(err);
      }
      // this.state.group.volume = volume;
      return callback();
    }.bind(this));
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setGroupMute = function(mute, callback) {
    mute = mute ? true : false;
    if (this.state.group.mute === mute) {
      return callback();
    }
    if (!this.isCoordinator) {
      return this.coordinator.setGroupMute(mute, callback);
    }
    this.log.info("%s: set group mute from %s to %s", this.name, this.state.group.mute, mute);
    const args = {
      InstanceID: 0,
      DesiredMute: mute
    };
    this.groupRenderingControl._request('SetGroupMute', args, function(err, status) {
      if (err) {
        this.log.error("%s: set group mute", this.name, err);
        return callback(err);
      }
      // this.state.group.mute = mute;
      return callback();
    }.bind(this));
  };

  // ===== SONOS INTERACTION ===================================================

  // Join a group.
  ZPAccessory.prototype.join = function(coordinator, callback) {
    this.log.debug("%s: join %s", this.name, coordinator.name);
    const args = {
      InstanceID: 0,
      CurrentURI: "x-rincon:" + coordinator.zp.id,
      CurrentURIMetaData: null
    };
    this.avTransport.SetAVTransportURI(args, function(err, status) {
      if (err) {
        this.log.error("%s: join %s: %s", this.name, coordinator.name, err);
        return callback(err);
      }
      return callback();
    }.bind(this));
  };

  // Leave a group.
  ZPAccessory.prototype.leave = function(callback) {
    const oldGroup = this.coordinator.name;
    this.log.debug("%s: leave %s", this.name, oldGroup);
    const args = {
      InstanceID: 0
    };
    this.avTransport.BecomeCoordinatorOfStandaloneGroup(args, function(err, status) {
      if (err) {
        this.log.error("%s: leave %s: %s", this.name, oldGroup, err);
        return callback(err);
      }
      return callback();
    }.bind(this));
  };

  // Transfer ownership and leave a group.
  ZPAccessory.prototype.abandon = function(newCoordinator, callback) {
    const oldGroup = this.coordinator.name;
    this.log.debug("%s: leave %s to %s", this.name, oldGroup, newCoordinator.name);
    const args = {
      InstanceID: 0,
      NewCoordinator: newCoordinator.zp.id,
      RejoinGroup: false
    };
    this.avTransport.DelegateGroupCoordinationTo(args, function(err, status) {
      if (err) {
        this.log.error("%s: leave %s to %s: %s", this.name, oldGroup, newCoordinator.name, err);
        return callback(err);
      }
      return callback();
    }.bind(this));
  };

  // Subscribe to Sonos ZonePlayer events
  ZPAccessory.prototype.subscribe = function(device, service, callback) {
    const subscribeUrl = "http://" + this.zp.host + ':' + this.zp.port + "/" +
    device + (device !== "" ? "/" : "") + service + "/Event";
    const callbackUrl = this.platform.callbackUrl + "/" + this.zp.id + "/" + service;
    const opt = {
      url: subscribeUrl,
      method: 'SUBSCRIBE',
      headers: {
        CALLBACK: "<" + callbackUrl + ">",
        NT: "upnp:event",
        TIMEOUT: "Second-" + this.platform.subscriptionTimeout
      }
    };
    this.request(opt, function(err, response) {
      if (err) {
        return callback(err);
      }
      this.log.debug("%s: new %s subscription %s (timeout %s)", this.name,
      service, response.headers.sid, response.headers.timeout);
      this.subscriptions[service] = response.headers.sid;
      setTimeout(function () {
        this.resubscribe(response.headers.sid, device, service);
      }.bind(this), (this.platform.subscriptionTimeout - 60) * 1000);
      return callback();
    }.bind(this));
  };

  // Renew subscription to Sonos ZonePlayer events
  ZPAccessory.prototype.resubscribe = function(sid, device, service) {
    if (sid === this.subscriptions[service]) {
      this.log.debug("%s: renewing %s subscription %s", this.name, service, sid);
      const subscribeUrl = "http://" + this.zp.host + ':' + this.zp.port + "/" +
      device + (device !== "" ? "/" : "") + service + "/Event";
      const callbackUrl = this.platform.callbackUrl + "/" + this.zp.id + "/" + service;
      const opt = {
        url: subscribeUrl,
        method: 'SUBSCRIBE',
        headers: {
          SID: sid,
          TIMEOUT: "Second-" + this.platform.subscriptionTimeout
        }
      };
      this.request(opt, function(err, response) {
        if (err) {
          this.log.error("%s: renew %s subscription %s: %s", this.name, service, sid, err);
          this.subscribe(device, service, function(err) {
            this.log.error("%s: subscribe to %s events: %s", this.name, service, err);
          }.bind(this));
          return;
        }
        this.log.debug("%s: renewed %s subscription %s (timeout %s)", this.name,
        service, response.headers.sid, response.headers.timeout);
        setTimeout(function () {
          this.resubscribe(response.headers.sid, device, service);
        }.bind(this), (this.platform.subscriptionTimeout - 60) * 1000);
      }.bind(this));
    }
  };

  // Send request to Sonos ZonePlayer.
  ZPAccessory.prototype.request = function(opt, callback) {
    this.log.debug("%s: %s %s", this.name, opt.method, opt.url);
    request(opt, function(err, response) {
      if (err) {
        this.log.error("%s: cannot %s %s (%s)", this.name, opt.method, opt.url, err);
        return callback(err);
      }
      if (response.statusCode !== 200) {
        this.log.error("%s: cannot %s %s (%d - %s)", this.name, opt.method, opt.url,
        response.statusCode, response.statusMessage);
        return callback(response.statusCode);
      }
      return callback(null, response);
    }.bind(this));
  };
