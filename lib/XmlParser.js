// homebridge-zp/lib/XmlParser.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const xml2js = require('xml2js')

// Words in uppercase to be converted to camelcase.
const _upperCaseWords = [
  'SCPD',
  'SSID',
  'UDN',
  'UUID',
  'URL',
  'ID'
]
const upperCaseWords = {}
for (const word of _upperCaseWords) {
  upperCaseWords[word] = {
    regexp: new RegExp('^(.*)' + word + '(.*)$'),
    lower: word.toLowerCase(),
    camel: word.charAt(0) + word.slice(1).toLowerCase()
  }
}

// Keys to be replaced.
const replacementKeys = {
  availableSoftwareUpdate: 'availableSoftwareUpdates',
  satellite: 'satellites',
  zoneGroupMember: 'zoneGroupMembers'
}

// Keys that contain lists and always should return an array.
// Value is the member key, or empty sting if none.
const arrayKeys = {
  availableSoftwareUpdates: 'updateItem',
  satellites: '',
  serviceStateTable: 'stateVariable',
  vanishedDevices: 'device',
  zoneGroups: 'zoneGroup',
  zoneGroupMembers: ''
}

// Keys to be ignore at root.
const rootKeys = [
  'e:propertyset',
  'root',
  'scpd',
  'zoneGroupState'
]

// XML parser
class XmlParser {
  constructor () {
    const xml2jsParserOptions = {
      explicitArray: false,
      mergeAttrs: true,
      attrNameProcessors: [this._processKey.bind(this)],
      attrValueProcessors: [this._processValue.bind(this)],
      tagNameProcessors: [this._processKey.bind(this)],
      valueProcessors: [this._processValue.bind(this)]
    }
    this._parser = new xml2js.Parser(xml2jsParserOptions)
    this._debug = debug('XmlParser')
  }

  async parse (xml) {
    return new Promise((resolve, reject) => {
      // this._debug('parse(%j)', xml)
      this._parser.parseString(xml, async (error, result) => {
        if (error != null) {
          return reject(error)
        }
        // this._debug('parse(%j) => %j', xml, result)
        return resolve(this._process(result))
      })
    })
  }

  // Convert key to javascript standard key.
  _processKey (key) {
    // const oldKey = key
    // this._debug('processKey(%j)', oldKey)

    // Convert uppercase keys to camelcase.
    for (const wordKey in upperCaseWords) {
      const word = upperCaseWords[wordKey]
      const a = word.regexp.exec(key)
      if (a != null) {
        key = a[1] + (a[1] === '' ? word.lower : word.camel) + a[2]
      }
    }

    // Convert initial uppercase to lowercase.
    key = key.charAt(0).toLowerCase() + key.slice(1)

    // Substite keys.
    if (replacementKeys[key] != null) {
      key = replacementKeys[key]
    }

    // this._debug('processKey(%j) => %j', oldKey, key)
    return key
  }

  // Convert value to proper javascript value.
  _processValue (value, key) {
    // const oldValue = value
    // this._debug('processValue(%j, %j)', oldValue, key)

    // Convert integer string to integer
    if (/^[0-9]+$/.test(value)) {
      value = parseInt(value)
    }

    // this._debug('processValue(%j, %j) => %j', oldValue, key, value)
    return value
  }

  // Post-process converted XML.
  async _process (value) {
    // Recursively parse XML strings.
    if (typeof value === 'string' && /^<.*>$/.test(value)) {
      return this.parse(value)
    }

    // Recursively post-process arrays.
    if (Array.isArray(value)) {
      const list = []
      for (const elt of value) {
        list.push(await this._process(elt))
      }
      return list
    }

    // Recursively post-process objects.
    if (typeof value === 'object') {
      const obj = {}
      // Skip over root keys.
      const keys = Object.keys(value)
      if (
        keys.length === 1 && rootKeys.includes(keys[0]) &&
        typeof value[keys[0]] === 'object'
      ) {
        return this._process(value[keys[0]])
      }
      // Recursively post-process key/value pairs.
      for (const key in value) {
        // Handle lists.
        const a = key.match(/^(.+)List$/)
        if (a != null || arrayKeys[key] != null) {
          const childKey = a == null ? arrayKeys[key] : a[1]
          let newValue = await this._process(value[key])
          const listKeys = Object.keys(newValue)
          if (listKeys.length === 1 && listKeys[0] === childKey) {
            newValue = newValue[childKey]
          }
          if (Array.isArray(newValue)) {
            obj[key] = newValue
          } else if (typeof newValue === 'object') {
            obj[key] = [newValue]
          } else {
            obj[key] = []
          }
          continue
        }
        // Handle e:property
        if (key === 'e:property') {
          const newValue = await this._process(value[key])
          if (Array.isArray(newValue)) {
            for (const property of newValue) {
              for (const key in property) {
                obj[key] = property[key]
              }
            }
          } else {
            for (const key in newValue) {
              obj[key] = newValue[key]
            }
          }
          continue
        }
        obj[key] = await this._process(value[key])
      }
      return obj
    }

    return value
  }
}

module.exports = XmlParser
