// homebridge-zp/lib/ZPAccessory.js
// (C) 2016, Erik Baauw
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

// ===== SONOS ACCESSORY =================================================================

// Constructor for ZPAccessory.
function ZPAccessory(platform, zp) {
  // Setup ZPAccessory, creating or adopting homekit accessory where needed.
  this.name = zp.zone + " Sonos";
  this.uuid_base = zp.id;
  this.zp = zp;
  this.platform = platform;
  this.subscriptions = {};
  this.state = {
    on: undefined,
    volume: undefined,
    mute: undefined,
    track: undefined,
    isCoordinator: undefined,
    group: undefined
  };
  this.log = this.platform.log;
  this.parser = new xml2js.Parser();

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "homebridge-zp")
    .setCharacteristic(Characteristic.Model, this.zp.model)
    .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);

  this.service = new Service.Switch(this.name);
  this.service.getCharacteristic(Characteristic.On)
    .on("get", function(callback) {callback(null, this.state.on);}.bind(this))
    .on("set", this.setOn.bind(this));
  this.service.addOptionalCharacteristic(Characteristic.Volume);
  this.service.getCharacteristic(Characteristic.Volume)
    .on("get", function(callback) {callback(null, this.state.volume);}.bind(this))
    .on("set", this.setVolume.bind(this));
  this.service.addOptionalCharacteristic(Characteristic.Mute);
  this.service.getCharacteristic(Characteristic.Mute)
    .on("get", function(callback) {callback(null, this.state.mute);}.bind(this))
    .on("set", this.setMute.bind(this));
  this.service.addOptionalCharacteristic(Characteristic.Track);
  this.service.getCharacteristic(Characteristic.Track)
    .on("get", function(callback) {callback(null, this.state.track);}.bind(this));

  this.avTransport = new SonosModule.Services.AVTransport(this.zp.host, this.zp.port);

  this.on("GroupManagement", this.handleGroupManagementEvent);
  this.on("AVTransport", this.handleAVTransportEvent);
  this.on("RenderingControl", this.handleRenderingControlEvent);

  this.createSubscriptions();
}

util.inherits(ZPAccessory, events.EventEmitter);

// Called by homebridge to initialise a static accessory.
ZPAccessory.prototype.getServices = function() {
  return [this.service, this.infoService];
};

// ===== SONOS EVENTS ====================================================================

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

ZPAccessory.prototype.createSubscriptions = function() {
  this.subscribe("", "GroupManagement", function(err) {
    if (err) {
      this.log.error("%s: subscribe to GroupManagement events: %s", this.name, err);
    }
    this.subscribe("MediaRenderer", "AVTransport", function(err) {
      if (err) {
        this.log.error("%s: subscribe to AVTransport events: %s", this.name, err);
      }
      this.subscribe("MediaRenderer", "RenderingControl", function(err) {
        if (err) {
          this.log.error("%s: subscribe to RenderingControl events: %s", this.name, err);
        }
      }.bind(this));
    }.bind(this));
  }.bind(this));
};

ZPAccessory.prototype.handleRenderingControlEvent = function(data) {
  this.log.debug("%s: RenderingControl event", this.name);
  this.parser.parseString(data.LastChange, function(err, json) {
    const event = json.Event.InstanceID[0];
    if (event.Volume) {
      const volume = Number(event.Volume[0].$.val);
      if (volume !== this.state.volume) {
        this.log.info("%s: volume changed from %d to %d", this.name, this.state.volume, volume);
        this.state.volume = volume;
        this.service.setCharacteristic(Characteristic.Volume, this.state.volume);
      }
    }
    if (event.Mute) {
      const mute = event.Mute[0].$.val === "1" ? true : false;
      if (mute !== this.state.mute) {
        this.log.info("%s: mute change from %s to %s", this.name, this.state.mute, mute);
        this.state.mute = mute;
        this.service.setCharacteristic(Characteristic.Mute, this.state.mute);
      }
    }
  }.bind(this));
};

ZPAccessory.prototype.handleAVTransportEvent = function(data) {
  this.log.debug("%s: AVTransport event", this.name);
  this.parser.parseString(data.LastChange, function(err, json) {
    if (err) {
      return;
    }
    let on = this.state.on;
    let track = this.state.track;
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
    if (on !== this.state.on) {
      this.log.info("%s: on changed from %s to %s", this.name, this.state.on, on);
      this.state.on = on;
      this.service.setCharacteristic(Characteristic.On, this.state.on);
      for (const member of this.members()) {
        if (member.state.on !== this.state.on) {
          this.log.info("%s: member on changed from %s to %s",
          member.name, member.state.on, this.state.on);
          member.state.on = this.state.on;
          member.service.setCharacteristic(Characteristic.On, member.state.on);
        }
      }
    }
    if (track !== this.state.track &&
      track !== "ZPSTR_CONNECTING" && track !== "ZPSTR_BUFFERING") {
        this.log.info("%s: track changed from %s to %s", this.name,
                      this.state.track, track);
        this.state.track = track;
        this.service.setCharacteristic(Characteristic.Track, this.state.track);
        for (const member of this.members()) {
          if (member.state.track !== this.state.track) {
            this.log.info("%s: member track changed from %s to %s", member.name,
                          member.state.track, this.state.track);
            member.state.track = this.state.track;
            member.service.setCharacteristic(Characteristic.Track, member.state.track);
          }
        }
      }
    }.bind(this));
  };

  ZPAccessory.prototype.handleGroupManagementEvent = function(data) {
    this.log.debug("%s: GroupManagement event", this.name);
    this.state.group = data.LocalGroupUUID;
    if (data.GroupCoordinatorIsLocal === "1") {
      this.state.isCoordinator = true;
      this.log.info("%s: coordinator of %s", this.name, this.state.group);
    } else {
      this.state.isCoordinator = false;
      this.log.info("%s: member of %s", this.name, this.state.group);
      const coordinator = this.coordinator();
      if (coordinator !== null) {
        if (this.state.on !== coordinator.state.on) {
          this.log.info("%s: member on changed from %s to %s", this.name,
                        this.state.on, coordinator.state.on);
          this.state.on = coordinator.state.on;
          this.service.setCharacteristic(Characteristic.On, this.state.on);
        }
        if (this.state.track !== coordinator.state.track) {
          this.log.info("%s: member track changed from %s to %s", this.name,
                        this.state.track, coordinator.state.track);
          this.state.track = coordinator.state.track;
          this.service.setCharacteristic(Characteristic.Track, this.state.track);
        }
      }
    }
  };

  // Return array of members.
  ZPAccessory.prototype.members = function() {
    let members = [];
    if (this.state.isCoordinator) {
      for (const id in this.platform.zpAccessories) {
        const accessory = this.platform.zpAccessories[id];
        if (accessory !== this && accessory.state.group === this.state.group) {
          members.push(accessory);
        }
      }
    }
    return members;
  };

  // Return coordinator for my group.
  ZPAccessory.prototype.coordinator = function() {
    return this.platform.coordinator(this.state.group);
  };

  // ===== HOMEKIT EVENTS ==================================================================

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setOn = function(on, callback) {
    on = on ? true : false;
    if (this.state.on === on) {
      return callback();
    }
    this.log.info("%s: set on from %s to %s", this.name, this.state.on, on);
    if (on) {
      const coordinator = this.platform.findCoordinator();
      if (coordinator) {
        this.join(coordinator, callback);
      } else {
        this.play(callback);
      }
    } else {
      if (this.state.isCoordinator) {
        if (this.members().length === 0) {
          this.stop(callback);
        } else {
          this.abandon(callback);
        }
      } else {
        this.leave(callback);
      }
    }
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setVolume = function(volume, callback) {
    if (this.state.volume === volume) {
      return callback();
    }
    this.log.info("%s: set volume from %d to %d", this.name, this.state.volume, volume);
    this.zp.setVolume(volume + "", function(err, data) {
      if (err) {
        this.log.error("%s: setVolume: %s", this.name, err);
        return callback(err);
      }
      this.state.volume = volume;
      return callback();
    }.bind(this));
  };

  // Called by homebridge when characteristic is changed from homekit.
  ZPAccessory.prototype.setMute = function(mute, callback) {
    mute = mute ? true : false;
    if (this.state.mute === mute) {
      return callback();
    }
    this.log.info("%s: set mute from %s to %s", this.name, this.state.mute, mute);
    this.zp.setMuted(mute, function(err, data) {
      if (err) {
        this.log.error("%s: setMuted", this.name, err);
        return callback(err);
      }
      this.state.mute = mute;
      return callback();
    }.bind(this));
  };

  // Play.
  ZPAccessory.prototype.play = function(callback) {
    this.log.debug("%s: play", this.name);
    this.zp.play(function(err, success) {
      if (err || !success) {
        this.log.error("%s: play: %s", this.name, err);
        return callback(err);
      }
      return callback();
    }.bind(this));
  };

  // Stop.
  ZPAccessory.prototype.stop = function(callback) {
    this.log.debug("%s: stop", this.name);
    this.zp.stop(function(err, success) {
      if (err || !success) {
        this.log.error("%s: stop: %s", this.name, err);
        return callback(err);
      }
      return callback();
    }.bind(this));
  };

  // Join a group.
  ZPAccessory.prototype.join = function(coordinator, callback) {
    this.log.debug("%s: join %s", this.name, coordinator.zp.zone);
    const args = {
      InstanceID: 0,
      CurrentURI: "x-rincon:" + coordinator.zp.id,
      CurrentURIMetaData: null
    };
    this.avTransport.SetAVTransportURI(args, function(err, status) {
      if (err) {
        this.log.error("%s: join %s: %s", this.name, coordinator.name, err);
      }
      return callback();
    }.bind(this));
  };

  // Leave a group.
  ZPAccessory.prototype.leave = function(callback) {
    const oldGroup = this.state.group;
    this.state.group = undefined;
    this.log.debug("%s: leave %s", this.name, oldGroup);
    const args = {
      InstanceID: 0
    };
    this.avTransport.BecomeCoordinatorOfStandaloneGroup(args, function(err, status) {
      if (err) {
        this.log.error("%s: leave %s: %s", this.name, oldGroup, err);
      }
      return callback();
    }.bind(this));
  };

  // Transfer ownership and leave a group.
  ZPAccessory.prototype.abandon = function(callback) {
    const newCoordinator = this.members()[0];
    const oldGroup = this.state.group;
    this.state.group = undefined;
    this.log.debug("%s: leave %s to %s", this.name, oldGroup, newCoordinator.name);
    const args = {
      InstanceID: 0,
      NewCoordinator: newCoordinator.zp.id,
      RejoinGroup: false
    };
    this.avTransport.DelegateGroupCoordinationTo(args, function(err, status) {
      if (err) {
        this.log.error("%s: leave %s to %s: %s", this.name, oldGroup, newCoordinator.name, err);
      }
      return callback();
    }.bind(this));
  };
