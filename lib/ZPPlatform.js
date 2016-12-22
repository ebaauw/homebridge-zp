// homebridge-zp/lib/ZPPlatform.js
// (C) 2016, Erik Baauw
//
// Homebridge plug-in for Sonos ZonePlayer.
//
// TODO:
// - Open session to found ZonePlayer and retrieve own address instead of
//   getting address from os.networkInterfaces().

"use strict";

const http = require("http");
const os = require("os");
const SonosModule = require("sonos");
const util = require("util");
const xml2js = require("xml2js");

const ZPAccessoryModule = require("./ZPAccessory");
const ZPAccessory = ZPAccessoryModule.ZPAccessory;
const packageConfig = require("../package.json");

module.exports = {
  ZPPlatform: ZPPlatform,
  setHomebridge: setHomebridge
};

// =======================================================================================
//
// Link platform module to Homebridge.

let Accessory;
let Service;
let Characteristic;
let homebridgeVersion;

function setHomebridge(homebridge) {
  // Link accessory modules to Homebridge.
  ZPAccessoryModule.setHomebridge(homebridge);

  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridgeVersion = homebridge.version;

  // Custom homekit characteristic for name of current track.
  Characteristic.Track = function() {
    Characteristic.call(this, 'Track', '04200003-0000-1000-8000-0026BB765291');
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Track, Characteristic);
}

// =======================================================================================

// Constructor for ZPPlatform.  Called by homebridge on load time.
function ZPPlatform(log, config) {
  this.log = log;
  this.name = config.name || "ZP";
  this.host = config.host || this.address();
  this.port = config.port || 0;
  this.searchTimeout = config.searchTimeout || 2;			// seconds
  this.searchTimeout *= 1000;						// milliseconds
  this.subscriptionTimeout = config.subscriptionTimeout || 30;	// minutes
  this.subscriptionTimeout *= 60;					// seconds

  this.players = [];
  this.zpAccessories = {};

  var msg = util.format.apply(msg, ["%s v%s, node %s, homebridge v%s",
                              packageConfig.name, packageConfig.version,
                              process.version, homebridgeVersion]);
  this.infoMessage = msg;
  this.log.info(this.infoMessage);

  this.parser = new xml2js.Parser();

  this.listen(function () {
    this.findPlayers();
  }.bind(this));
}

// Return first non-loopback IPv4 address.
ZPPlatform.prototype.address = function() {
  const interfaces = os.networkInterfaces();
  for (const id in interfaces) {
    const aliases = interfaces[id];
    for (const aid in aliases) {
      const alias = aliases[aid];
      if (alias.family === "IPv4" && alias.internal === false) {
        return alias.address;
      }
    }
  }
  return "0.0.0.0";
};


// Called by homebridge to retrieve static list of ZPAccessories.
ZPPlatform.prototype.accessories = function(callback) {
  let accessoryList = [];
  // Allow for search to find all Sonos ZonePlayers.
  setTimeout(function() {
    for (const zp of this.players) {
      const accessory = new ZPAccessory(this, zp);
      this.zpAccessories[zp.id] = accessory;
      accessoryList.push(accessory);
    }
    return callback(accessoryList);
  }.bind(this), this.searchTimeout);
};

// Fix errors in sonos module.
function fixService(service) {
  service.controlURL = service.controlURL.replace("/MediaRenderer", "");
  service.eventSubURL = service.eventSubURL.replace("/MediaRenderer", "");
}

// Create listener to receive notifications from Sonos ZonePlayers.
ZPPlatform.prototype.listen = function(callback) {
  this.server = http.createServer(function(request, response) {
    let buffer = "";
    request.on("data", function(data) {
      buffer += data;
    }.bind(this));
    request.on("end", function() {
      request.body = buffer;
      // this.log.debug("listener: %s %s", request.method, request.url);
      if (request.method === "GET" && request.url === "/notify") {
        // Provide an easy way to check that listener is reachable.
        response.writeHead(200, {'Content-Type': 'text/plain'});
        response.write(this.infoMessage);
      } else if (request.method === "NOTIFY") {
	      const array = request.url.split("/");
        const accessory = this.zpAccessories[array[2]];
	      const service = array[3];
	      if (array[1] === "notify" && accessory !== null && service !== null) {
	        this.parser.parseString(request.body.toString(), function(error, json) {
	          const properties = json["e:propertyset"]["e:property"];
	          let obj = {};
            for (const prop of properties) {
              for (const key in prop) {
                obj[key] = prop[key][0];
              }
            }
            accessory.emit(service, obj);
          }.bind(this));
        }
      }
      response.end();
    }.bind(this));
  }.bind(this));
  this.server.listen(this.port, this.host, function() {
    this.callbackUrl = "http://" + this.server.address().address + ":" +
                       this.server.address().port + "/notify";
    this.log.debug("listening on %s", this.callbackUrl);
    return callback();
  }.bind(this));
};

ZPPlatform.prototype.findPlayers = function() {
  SonosModule.search(/* {timeout: this.searchTimeout}, */ function(zp, model) {
    const deviceProperties = new SonosModule.Services.DeviceProperties(zp.host, zp.port);
    const zoneGroupTopology = new SonosModule.Services.ZoneGroupTopology(zp.host, zp.port);
    fixService(deviceProperties);
    fixService(zoneGroupTopology);
    zp.model = model;
    deviceProperties.GetZoneAttributes({}, function(err, attrs) {
      if (err) {
        this.log.error("%s:%s: error %s", zp.host, zp.port, err);
      } else {
        zp.zone = attrs.CurrentZoneName;
	      // this.log.debug("%s: zone attrs %j", zp.zone, attrs);
	      deviceProperties.GetZoneInfo({}, function(err, info) {
          if (err) {
            this.log.error("%s: error %s", zp.zone, err);
          } else {
            // this.log.debug("%s: info %j", sonos.zone, info);
            zp.id = "RINCON_" + info.MACAddress.replace(/:/g, "") +
	    		          ("00000" + zp.port).substr(-5, 5);
	          zoneGroupTopology.GetZoneGroupAttributes({}, function (err, attrs) {
	            if (err) {
                this.log.error("%s: error %s", zp.zone, err);
	            } else {
	              // this.log.debug("%s: zone group attrs %j", zp.zone, attrs);
		            if (attrs.CurrentZoneGroupID === "") {
		              this.log.debug("%s: ignore slave %s player %s at %s:%s",
				                         zp.zone, zp.model, zp.id, zp.host, zp.port);
		            } else {
		              this.log.debug("%s: setup %s player %s at %s:%s",
				                         zp.zone, zp.model, zp.id, zp.host, zp.port);
		              this.players.push(zp);
		            }
	            }
            }.bind(this));
          }
        }.bind(this));
      }
    }.bind(this));
  }.bind(this));
};

ZPPlatform.prototype.findCoordinator = function() {
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id];
    if (accessory.state.isCoordinator && accessory.state.on &&
    	  accessory.state.track != "TV") {
      return accessory;
    }
  }
};

ZPPlatform.prototype.coordinator = function(group) {
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id];
    if (accessory.state.isCoordinator && accessory.state.group === group) {
      return accessory;
    }
  }
  return null;
};
