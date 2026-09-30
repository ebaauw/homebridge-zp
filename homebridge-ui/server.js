// homebridge-zp/homebridge-ui/server.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { UiServer } from 'homebridge-lib/UiServer'

class ZpUiServer extends UiServer {
  constructor () {
    super()
    this.ready()
  }
}

new ZpUiServer() // eslint-disable-line no-new
