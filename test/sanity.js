'use strict'

let test = require('tape')
let fse = require('fs-extra')
let path = require('path')

require('ngn')
require('ngn-data')
require('../')

let root = require('path').join(__dirname, './data/db.txt')
let root2 = require('path').join(__dirname, './data/db_2.txt')

fse.emptyDirSync(path.dirname(root))

let meta = function () {
  return {
    idAttribute: 'testid',
    fields: {
      testid: null,
      firstname: null,
      lastname: null,
      val: {
        min: 10,
        max: 20,
        default: 15
      }
    }
  }
}

test('Primary Namespace', function (t) {
  t.ok(NGNX.DATA.FileProxy !== undefined, 'NGNX.DATA.FileProxy is defined globally.')
  t.end()
})

test('Self Inspection', function (t) {
  let m = meta()
  let NewModel = new NGN.DATA.Model(m)
  let dataset = new NGN.DATA.Store({
    model: NewModel,
    proxy: new NGNX.DATA.FileProxy(root)
  })

  t.ok(dataset.proxy.type === 'store', 'Recognized store.')

  m.proxy = new NGNX.DATA.FileProxy(root)

  let TestRecord = new NGN.DATA.Model(m)
  let rec = new TestRecord({
    firstname: 'The',
    lastname: 'Doctor'
  })

  t.ok(rec.proxy.type === 'model', 'Recognized model.')
  t.end()
})

test('Cryptography for Data at Rest', function (t) {
  let m = meta()
  m.proxy = new NGNX.DATA.FileProxy({
    file: root,
    encryptionKey: 't3stK3y'
  })

  let NewModel = new NGN.DATA.Model(m)

  let record = new NewModel({
    firstname: 'The',
    lastname: 'Doctor'
  })

  let hash = record.proxy.encrypt(JSON.stringify(record.data))
  t.ok(hash !== null && hash !== undefined, 'Content successfully encrypted.')

  let out = record.proxy.decrypt(hash)
  t.ok(typeof JSON.parse(out) === 'object', 'Decrypted to object.')
  t.ok(JSON.parse(out).lastname === 'Doctor', 'Decrypted data matches unencrypted data.')

  t.end()
})

test('Lockfile Settings', function (t) {
  let m = meta()
  m.proxy = new NGNX.DATA.FileProxy({
    file: root,
    autolock: false
  })

  let NewModel = new NGN.DATA.Model(m)
  let record = new NewModel({
    firstname: 'The',
    lastname: 'Doctor'
  })

  t.ok(!record.proxy.locked, 'Disabling autolock results in an "unlocked" state.')
  t.ok(!record.proxy.isLockOwner, 'Disabling autolock results in the process NOT identifying itself as the lock owner.')
  t.ok(record.proxy.presave(), 'Presave does not block on lock.')

  let m2 = meta()
  m2.proxy = new NGNX.DATA.FileProxy({
    file: root2,
    autolock: false
  })

  let record2 = new NewModel({
    firstname: 'The',
    lastname: 'Master'
  })

  try {
    record2.proxy.lock()
    t.ok(record2.proxy.locked, 'Locking a file that does not exist yet touches the file and creates the lock.')

    record2.proxy.unlock()

    fse.removeSync(root2)

    if (NGN.util.pathExists(root2)) {
      throw new Error(`Could not remove "${root2}". The test did not clean up properly and this file may need to be removed manually.`)
    }

    t.end()
  } catch (e) {
    t.fail(e.message)
  }
})
