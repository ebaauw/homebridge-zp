#!/usr/bin/env node

// homebridge-zp/cli/upnp.js
// Copyright © 2019-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const homebridgeLib = require('homebridge-lib')

new homebridgeLib.UpnpCommand().main()
