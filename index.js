'use strict'

require('ngnx-data-proxy-database')

/**
 * @class NGNX.DATA.FileProxy
 * Persist NGN DATA stores to a local file. This class was designed to be
 * extended for specific file types, such as JSON, XML, YML, etc. It provides
 * common functionality relative to working with the file system, but specific
 * file storage logic should reside in a more specific class.
 */
class FileProxy extends NGNX.DATA.DatabaseProxy {
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
      dbfile: NGN.private(config.file),

      /**
       * @cfgproperty {boolean} [autolock=true]
       * Automatically control the lock file when saving to disk. This will lock
       * the file before a write/save and unlock it when the write/save
       * operation is complete.
       *
       * For manual control, set this to `false`. When autolock is disabled, the
       * #lock and #unlock methods are **not** executed automatically on a
       * write/save. In this case, the methods must be called manually. For most
       * scenarios, this is unnecessary. However; if a an application must block
       * access to the file even when it is not writing to disk, autolock can
       * be disabled and locking can be implemented manually.
       */
      _autolock: NGN.privateconst(NGN.coalesce(config.autolock, true)),

      /**
       * @cfg {boolean} [hideLockedFile=true]
       * By default, a file is hidden when it is locked (the hidden flag is
       * updated on the operating system). This behavior can be disabled by
       * setting this to `false`.
       */
      hidelock: NGN.private(NGN.coalesce(config.hideLockedFile, true)),

      // A proper file locker
      filelocker: NGN.privateconst(require('proper-lockfile')),

      // A file lock release mechanism (populated dynamically)
      _release: NGN.private(null),

      // A placeholder to determine if this process created the lockfile.
      _lockowner: NGN.private(false),

      _exec: NGN.privateconst(require('child_process').execSync)
    })
  }

  get os () {
    return require('os').platform()
  }

  get autolock () {
    return this._autolock
  }

  set autolock (value) {
    if (typeof value !== 'boolean') {
      console.warn('Cannot set autolock to a non-boolean value (received ' + (typeof value) + ')')
      return
    }

    this._autolock = value
  }

  /**
   * @property {boolean} locked
   * Indicates the file is locked by a process.
   * @readonly
   */
  get locked () {
    try {
      return this.filelocker.checkSync(this.dbfile, {
        realpath: false
      })
    } catch (e) {
      return false
    }
  }

  get isLockOwner () {
    return this._lockowner
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
   * @method hide
   * Hide the specified file or directory. In Linux/Unix environments,
   * hiding a file requires renaming it to begin with a `.`, such as
   * `.myfile.json`. This is handled automatically by this method. On
   * Windows and macOS, a flag is used to mark the file as hidden, but no
   * change is made to the filename/path.
   * @param {String} absolutePath
   * The absolute path of the file or directory to hide.
   * @private
   */
  hide (absolutePath) {
    if (!NGN.util.pathReadable(absolutePath)) {
      console.warn('Cannot hide ' + absolutePath + ' (does not exist or cannot be found)')
      return
    }

    switch (this.os) {
      // macOS support using chflags
      case 'darwin':
        this._exec('chflags hidden \"' + absolutePath + '\"')
        return

      case 'win32':
        this._exec('attrib +h \"' + absolutePath + '\"')
        return

      default:
        let asset = require('path').basename(this.dbfile)

        if (asset.substr(0, 1) === '.') {
          return
        }

        let newFilepath = this.dbfile.replace(asset, '.' + asset)

        require('fs').renameSync(this.dbfile, newFilepath)
        this.dbfile = newFilepath
        return
    }
  }

  /**
   * @method unhide
   * Make the specified file or directory visible in the OS.
   * @param {String} absolutePath
   * The absolute path of the file or directory to show.
   * @private
   */
  unhide (absolutePath) {
    if (!NGN.util.pathReadable(absolutePath)) {
      console.warn('Cannot hide ' + absolutePath + ' (does not exist or cannot be found)')
      return
    }

    switch (this.os) {
      // macOS support using chflags
      case 'darwin':
        this._exec('chflags nohidden \"' + absolutePath + '\"')
        return

      case 'win32':
        this._exec('attrib -h \"' + absolutePath + '\"')
        return

      default:
        let asset = require('path').basename(this.dbfile)

        if (asset.substr(0, 1) !== '.') {
          return
        }

        let newFilepath = this.dbfile.replace(asset, asset.substr(1, asset.length))

        require('fs').renameSync(this.dbfile, newFilepath)
        this.dbfile = newFilepath
        return
    }
  }

  /**
   * @method denyWrite
   * Make the #file read-only for all processes except this one.
   * In other words, only this process can write to the file.
   * @private
   */
  denyWrite () {
    if (!NGN.util.pathWritable(this.dbfile)) {
      return
    }

    switch (this.os) {
      case 'win32':
        this._exec('attrib +r \"' + this.dbfile + '\"')
        return

      default:
        require('fs').chmodSync(this.dbfile, 600)
        return
    }
  }

  /**
   * @method allowWrite
   * Allow other processes to write to #file.
   * @private
   */
  allowWrite () {
    if (NGN.util.pathWritable(this.dbfile)) {
      return
    }

    switch (this.os) {
      case 'win32':
        this._exec('attrib -r \"' + this.dbfile + '\"')
        return

      default:
        require('fs').chmodSync(this.dbfile, 666)
        return
    }
  }

  /**
   * @method lock
   * Create a lock file.
   * @fires filelock
   * Triggered when a file lock is created on #file.
   * @private
   */
  lock () {
    if (this.locked) {
      return
    }

    // Store the release mechanism
    this._release = this.filelocker.lockSync(this.dbfile, {
      realpath: false,
      stale: 5000,
      update: 2000
    })

    // Identify this process as the lock owner.
    this._lockowner = true

    // Hide the locked file.
    if (this.hidelock) {
      this.hide(this.dbfile)
    }

    this.emit('filelock')
  }

  /**
   * @method unlock
   * Remove a lock file.
   * @fires fileunlock
   * Triggered when the #file lock is released.
   * @private
   */
  unlock () {
    if (!this.locked) {
      return
    }

    if (!this.isLockOwner) {
      console.warn('Cannot unlock (this process does not own the lockfile.)')
      return
    }

    if (this._release) {
      this._release(() => {
        this.emit('fileunlock')
      })
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
   * @returns {boolean}
   * Returns `true` if the save process should continue, `false`if it should not.
   * @private
   */
  presave () {
    if (this.locked) {
      throw new Error(this.dbfile + ' is locked by another process. Cannot save.')
    }

    if (this.type === 'model' && this.store.proxyignore) {
      return false
    }

    if (this.type === 'store') {
      this.store.addFilter(this.proxyRecordFilter)
    }

    // Create the output directory if it doesn't already exist.
    this.mkdirp(require('path').dirname(this.dbfile))

    return true
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
    // If autolock is enabled and the file isn't already
    // locked, lock it.
    if (this._autolock) {
      this.lock()
    }

    // Optionally encrypt data
    if (encryptdata && this.munge) {
      content = this.encrypt(content)
    }

    // Write contents to disk
    require('fs').writeFileSync(this.dbfile, content, {
      encoding: 'utf8'
    })

    // If autolock is enabled and the file is locked, unlock it.
    if (this._autolock && this.locked) {
      this.unlock()
    }
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

  /**
   * @method createModelRecord
   * Saves the data to the #file.
   * @private
   */
  createModelRecord () {
    this.proxy.saveAndEmit('live.create').apply(this, arguments)
  }

  /**
   * @method updateModelRecord
   * Saves the data to the #file.
   * @private
   */
  updateModelRecord () {
    this.proxy.saveAndEmit('live.update').apply(this, arguments)
  }

  /**
   * @method deleteModelRecord
   * Saves the data to the #file.
   * @private
   */
  deleteModelRecord () {
    this.proxy.saveAndEmit('live.delete').apply(this, arguments)
  }

  /**
   * @method createStoreRecord
   * Saves the data to the #file.
   * @private
   */
  createStoreRecord () {
    this.proxy.saveAndEmit('live.create').apply(this, arguments)
  }

  /**
   * @method updateStoreRecord
   * Saves the data to the #file.
   * @private
   */
  updateStoreRecord () {
    this.proxy.saveAndEmit('live.update').apply(this, arguments)
  }

  /**
   * @method deleteStoreRecord
   * Saves the data to the #file.
   * @private
   */
  deleteStoreRecord () {
    this.proxy.saveAndEmit('live.delete').apply(this, arguments)
  }

  /**
   * @method clearStoreRecords
   * Clears the data in the #file.
   * @private
   */
  clearStoreRecords () {
    this.proxy.saveAndEmit('live.delete').apply(this, arguments)
  }

  /**
   * @method saveAndEmit
   * A helper method to automatically save and emit an event upon completion.
   * @private
   */
  saveAndEmit (eventName) {
    return (record) => {
      this.save(() => {
        this.emit(eventName, record || null)
        this.store.emit(eventName, record || null)
      })
    }
  }
}

global.NGNX = NGN.coalesce(global.NGNX, {DATA: {}})
global.NGNX.DATA = NGN.coalesce(global.NGNX.DATA, {})
Object.defineProperty(global.NGNX.DATA, 'FileProxy', NGN.const(FileProxy))
