'use strict'

/**
 * @class NGNX.DATA.FileProxy
 * Persist NGN DATA stores to a local file. This class was designed to be
 * extended for specific file types, such as JSON, XML, YML, etc. It provides
 * common functionality relative to working with the file system, but specific
 * file storage logic should reside in a more specific class.
 */
class FileProxy extends NGN.DATA.Proxy {
  constructor (config) {
    if (typeof config === 'string') {
      config = {
        file: config
      }
    }

    config = config || {}

    if (!config.file) {
      console.log('Invalid Configuration:', config, '(' + typeof config + ')')
      throw new Error('No datafile configuration detected.')
    }

    config.file = require('path').resolve(config.file)

    if (!NGN.util.pathReadable(config.file)) {
      console.warn(config.file + ' does not exist or cannot be found. It will be created automatically if any data operation is requested.')
    }

    super(config)

    Object.defineProperties(this, {
      /**
       * @cfg {string} file
       * Path to the JSON file.
       */
      dbfile: NGN.const(config.file),

      /**
       * @cfg {string} [encryptionKey=null]
       * Set this to a hash key to obfuscate (scramble) the data. This is a
       * reversible hashing method and should not be considered "secure", but it
       * will make the file on disk unreadable to a human if they do not have
       * the key.
       */
      munge: NGN.private(NGN.coalesce(config.encryptionKey, null)),

      /**
       * @cfg {string} [cipher=aes-256-cbc]
       * The type of cipher to use when encrypting/decrypting data at rest.
       * This is only applied if #encryptionKey is provided.
       */
      cipher: NGN.privateconst(NGN.coalesce(config.cipher, 'aes-256-cbc')),

      // A proper file locker
      filelocker: NGN.privateconst(require('proper-lockfile')),

      // A file lock release mechanism (populated dynamically)
      _release: NGN.private(null)
    })
  }

  /**
   * @property {boolean} locked
   * Indicates the file is locked by a process.
   * @readonly
   */
  get locked () {
    let response = false

    try {
      response = this.filelocker.checkSync(this.dbfile, {
        realpath: false
      })
    } catch (e) {}

    return response
  }

  /**
   * @method mkdirp
   * A helper method for guaranteeting a directory exists.
   * @param {string} absolutePath
   * The absolute path of the directory that should exist.
   * @private
   */
  mkdirp (dir) {
    if (NGN.util.pathReadable(dir)) {
      return
    }

    if (NGN.util.pathReadable(require('path').join(dir, '..'))) {
      require('fs').mkdirSync(dir)
      return
    }

    this.mkdirp(require('path').join(dir, '..'))
    this.mkdirp(dir)
  }

  /**
   * @method encrypt
   * Encrypt text using the configured #cipher and #encryptionKey.
   * @param {string} decryptedContent
   * The content to be encrypted.
   * @private
   */
  encrypt (data) {
    let cipher = require('crypto').createCipher(this.cipher, this.munge)
    let encoded = cipher.update(data, 'utf8', 'hex')
    encoded += cipher.final('hex')
    return encoded
  }

  /**
   * @method decrypt
   * Decrypt text using the configured #cipher and #encryptionKey.
   * @param {string} encryptedContent
   * The content to be decrypted.
   * @private
   */
  decrypt (data) {
    let cipher = require('crypto').createDecipher(this.cipher, this.munge)
    let decoded = cipher.update(data, 'hex', 'utf8')
    decoded += cipher.final('utf8')
    return decoded
  }

  /**
   * @method lock
   * Create a lock file.
   * @private
   */
  lock () {
    this._release = this.filelocker.lockSync(this.dbfile, {
      stale: 5000,
      update: 1000,
      realpath: false
    })
  }

  /**
   * @method unlock
   * Remove a lock file.
   * @private
   */
  unlock () {
    if (this._release) {
      this._release()
    }

    this._release = null
  }

  save () {
    console.log('This method should be overridden by a custom save method.')
  }

  /**
   * @method presave
   * Checks to assure the file can be accessed (i.e. not locked) and assures
   * the filepath is accessible (mkdirp). Automatically locks the file.
   * @private
   */
  presave () {
    if (this.locked) {
      throw new Error('Process ID ' + this.proxy.lockfilepid + ' has a lock on ' + this.dbfile + '. Cannot save.')
    }

    // Create the output directory if it doesn't already exist.
    this.mkdirp(require('path').dirname(this.dbfile))

    // Create a lock file
    this.lock()
  }

  /**
   * @method postsave
   * Cleanup after the save operation is complete.
   * @param {function} [callback]
   * An optional callback method to fire after the save is complete.
   * @private
   */
  postsave (callback) {
    // Unlock
    this.unlock()

    this.emit('save')
    this.store.emit('save')

    if (NGN.isFn(callback)) {
      callback()
    }
  }

  /**
   * @method postfetch
   * A helper method to cleanup after fetching data.
   * @param {function} [callback]
   * An optional callback method to fire after the save is complete.
   * @param {any} content
   * The content to send to the callback/event handler.
   * @fires fetch
   * @private
   */
  postfetch (callback, content) {
    this.emit('fetch', content)
    this.store.emit('fetch', content)

    if (NGN.isFn(callback)) {
      callback(content)
    }
  }

  /**
   * @method writeToDisk
   * A helper method to write the content to disk in UTF8 format.
   * This automatically overwrites anything that may already exist in the file.
   * @param {string} content
   * The content to write to the file.
   * @param {boolean} encrypt
   * Encrypt the content if an #encryptionKey is configured.
   * @private
   */
  writeToDisk (content, encryptdata = true) {
    // Optionally encrypt data
    if (encryptdata && this.munge) {
      content = this.encrypt(content)
    }

    // Write contents to disk
    require('fs').writeFileSync(this.dbfile, content, {
      encoding: 'utf8'
    })
  }

  /**
   * @method readFromDisk
   * A helper method to read file content from disk without caching.
   * @param {boolean} [decrypt=true]
   * Attempt to decrypt the file content if an #encryptionKey has been configured.
   * If no #encryptionKey is provided, the content will be returned without decrypting.
   * @param {function} [callback]
   * An optional callback method to fire after the save is complete.
   * @private
   */
  readFromDisk (decrypt = true, callback) {
    if (!NGN.util.pathReadable(this.dbfile)) {
      return null
    }

    let content

    try {
      content = require('fs').readFileSync(this.dbfile).toString()
    } catch (err) {
      throw err
    }

    if (decrypt && this.munge) {
      if (this.munge) {
        content = this.decrypt(content)
      } else {
        throw new Error('Unrecognized or encrypted format detected. If the file is encrypted, the proxy must have an encryptionKey configured..')
      }
    }

    return content
  }
}

global.NGNX = NGN.coalesce(global.NGNX, {DATA: {}})
global.NGNX.DATA = NGN.coalesce(global.NGNX.DATA, {})
Object.defineProperty(global.NGNX.DATA, 'FileProxy', NGN.const(FileProxy))
