// Clappr player is Copyright 2014 Globo.com Player authors. All rights reserved.

import {Browser, CorePlugin, Events, Playback, $} from 'clappr'
import gaTrackingSnippet from './ga-tracking'

export default class GaEventsPlugin extends CorePlugin {
  get name() { return 'ga_events' }

  constructor(core) {
    super(core)
    this._volumeTimer = null
    this._doSendPlay = true
    this._isIos = Browser.isiOS
    this.log = {};
    this.log.history = [];
    this.readPluginConfig(this.options.gaEventsPlugin)
    //debug("plugin constructor after", this._trackerName, this._createFieldsObject)
    gaTrackingSnippet(this._gaCfg.name, this._gaCfg.debug, this._gaCfg.trace, (r) => {
      this.debug("ga create", this._createFieldsObject)
      r && this._ga('create', this._trackingId, this._trackerName, this._createFieldsObject)

      if(this._gaCreateCallback) {
        this.debug('running custom callback', this._gaCreateCallback);
        this._gaCreateCallback;
      }

      if(this._gaCustomTasks.length > 0) {
        this.debug('adding custom tasks');
        this._gaCustomTasks.map((task) => {
          this.debug('adding task', task.name);
          this._ga('set', task.name, task.func);
        });
      }

    })
  }

  get __container() {
    return this.core.activeContainer
      ? this.core.activeContainer
      : this.core.mediaControl.container
  }

  debug(...theArgs) {
    if(this._gaCfg.debug) {
      if(typeof(console) !== 'undefined') {
        //console.info('debug console not undef', theArgs);
        this.log.history.push(theArgs);
        if(console) {
          //console.info('debug have console');
          const newarr = [].slice.call(theArgs);
          //fconsole.info('debug', newarr);
          (typeof console.info === 'object' ? this.log.apply.call(console.info, console, newarr) : console.info.apply(console, newarr));
        }
        }
    }
  }

  bindEvents() {
    this.listenTo(this.core, Events.CORE_READY, this.onCoreReady)
    if (Events.CORE_ACTIVE_CONTAINER_CHANGED) {
      this.listenTo(this.core, Events.CORE_ACTIVE_CONTAINER_CHANGED, this.containerChanged)
    } else {
      this.listenTo(this.core.mediaControl, Events.MEDIACONTROL_CONTAINERCHANGED, this.containerChanged)
    }

    if (this.__container) {
      // Set resolved source as eventLabel if not defined in plugin configuration
      if (!this._label) {
        this._label = this.__container.options.src
      }
      this._isLive = this.__container.getPlaybackType() === Playback.LIVE
      this.listenTo(this.__container, Events.CONTAINER_SETTINGSUPDATE, this.onSettingsUpdate)
      this.listenTo(this.__container, Events.CONTAINER_TIMEUPDATE, this.onTimeUpdate)
      this.listenTo(this.__container, Events.CONTAINER_PLAY, this.onPlay)
      this.listenTo(this.__container, Events.CONTAINER_SEEK, (event) => this.onSeek(event))
      this.listenTo(this.__container, Events.CONTAINER_PAUSE, this.onPause)
      this.listenTo(this.__container, Events.CONTAINER_STOP, this.onStop)
      this.listenTo(this.__container, Events.CONTAINER_ENDED, this.onEnded)
      this._hasEvent('ready') && this.listenTo(this.__container, Events.CONTAINER_READY, this.onReady)
      this._hasEvent('buffering') && this.listenTo(this.__container, Events.CONTAINER_STATE_BUFFERING, this.onBuffering)
      this._hasEvent('bufferfull') && this.listenTo(this.__container, Events.CONTAINER_STATE_BUFFERFULL, this.onBufferFull)
      this._hasEvent('loadedmetadata') && this.listenTo(this.__container, Events.CONTAINER_LOADEDMETADATA, this.onLoadedMetadata)
      this._hasEvent('volume') && this.listenTo(this.__container, Events.CONTAINER_VOLUME, (event) => this.onVolumeChanged(event))
      this._hasEvent('fullscreen') && this.listenTo(this.core, Events.CORE_FULLSCREEN, this.onCoreFullscreen)
      this._hasEvent('playbackstate') && this.listenTo(this.__container, Events.CONTAINER_PLAYBACKSTATE, this.onPlaybackChanged)
      this._hasEvent('highdefinitionupdate') && this.listenTo(this.__container, Events.CONTAINER_HIGHDEFINITIONUPDATE, this.onHD)
      this._hasEvent('playbackdvrstatechanged') && this.listenTo(this.__container, Events.CONTAINER_PLAYBACKDVRSTATECHANGED, this.onDVR)
      this._hasEvent('error') && this.listenTo(this.__container, Events.CONTAINER_ERROR, this.onError)
    }
  }

  getExternalInterface() {
      // Expose player method only if tracker name is available
      if (this._trackerName) {
        return {
          gaEventsTracker: this.gaTracker
        }
      }

      return {}
  }

  onCoreReady() {
    // Since Clappr 0.2.84, "CORE_READY" event is trigerred after container changed
    this.options.gaEventsPlugin && this.readPluginConfig(this.options.gaEventsPlugin)
  }

  containerChanged() {
    this.stopListening()
    this.bindEvents()
  }

  get _ga() {
    return window[window.GoogleAnalyticsObject]
  }

  gaTracker() {
    this.debug("gaTracker func", this._trackerName)
    return this._ga.getByName && this._ga.getByName(this._trackerName)
  }

  gaEvent(category, action, label, value) {
    this.debug("gaEvent", category, action, label, value)
    
    let obj = {};

    if (this._gaCustomDimensions) {
      for(let customDataKey in this._gaCustomDimensions) {
        obj[customDataKey] = this._gaCustomDimensions[customDataKey]
      }
    }

    obj.eventCategory = category;
    obj.eventAction = action;
    obj.eventLabel = label;
    obj.eventValue = value;

    this.debug("final Event Data", obj)

    // Check if next event must use "beacon" transport
    // https://developers.google.com/analytics/devguides/collection/analyticsjs/field-reference#transport
    if (this._gaBeacon) {
      obj.transport = 'beacon'
      this._gaBeacon = false
    }

    this._ga(this._send, 'event', obj)
  }

  gaException(desc, isFatal=false) {
    this._ga(this._send, 'exception', {
      'exDescription': desc,
      'exFatal': isFatal
    })
  }

  updateEventLabel(lbl){
    this.debug("updateEventLabel", lbl);
    this._label = lbl;
  }

  updateCustomDimensions(dimensions){
    this.debug("updateCustomDimensions", dimensions);
    for(let dim in dimensions) {
      if(dim.indexOf('dimension') != 0 && dim.indexOf('metric') != 0) {
        this.debug("skipping invalid entry " + dim);
        continue;
      }
      this._gaCustomDimensions[dim] = dimensions[dim];
    }
    this.debug("updateCustomDimensions", this._gaCustomDimensions);
  }

  readPluginConfig(cfg) {
    if (!cfg) {
      throw new Error(this.name + ' plugin config is missing')
    }
    if (!cfg.trackingId) {
      throw new Error(this.name + ' plugin "trackingId" required config parameter is missing')
    }

    this._gaCfg = cfg.gaCfg || { name: 'ga', debug: false, trace: false }
    this._trackingId = cfg.trackingId
    this._createFieldsObject = cfg.createFieldsObject
    this._trackerName = this._createFieldsObject && this._createFieldsObject.name
    this._send = this._trackerName ? this._trackerName + '.send' : 'send'
    this._category = cfg.eventCategory || 'Video'
    this._label = cfg.eventLabel // Otherwise filled in bindEvents()
    this._setValue = cfg.eventValueAuto === true
    this._asLive = cfg.eventValueAsLive === true
    this._events = $.isArray(cfg.eventToTrack) && cfg.eventToTrack || this._defaultEvents
    this._eventMap = $.isPlainObject(cfg.eventMapping) && {...this._defaultEventMap, ...cfg.eventMapping} || this._defaultEventMap
    this._gaPlayOnce = cfg.sendPlayOnce === true
    this._gaEx = cfg.sendExceptions === true
    this._gaExDesc = cfg.sendExceptionsMsg === true
    this._gaCustomTasks = cfg.customTasks || [];
    this._gaCreateCallback = cfg.gaCreateCallback || null;

    this.debug("_gaCreateCallback", this._gaCreateCallback);
    //this.debug("trackerName", this._trackerName)

    //ADD CUSTOM DATA TO CONFIG
    this._gaCustomDimensions = cfg.customDimensions || {}

    if (cfg.stopOnLeave === true) this.stopOnLeave()

    // Add 'error' to tracked events if GA exceptions are enabled
    if (this._gaEx && !this._hasEvent('error')) this._events.push('error')

    this._gaPercent = $.isArray(cfg.progressPercent) && cfg.progressPercent || []
    this._gaPercentCat = cfg.progressPercentCategory || this._category
    this._gaPercentAct = $.isFunction(cfg.progressPercentAction) && cfg.progressPercentAction || function(i) { return 'progress_' + i + 'p' }
    this._processGaPercent = this._gaPercent.length > 0

    this._gaSeconds = $.isArray(cfg.progressSeconds) && cfg.progressSeconds || []
    this._gaSecondsCat = cfg.progressSecondsCategory || this._category
    this._gaSecondsAct = $.isFunction(cfg.progressSecondsAction) && cfg.progressSecondsAction || function(i) { return 'progress_' + i + 's' }
    this._progressTimerStarted = false
    this._processGaSeconds = this._gaSeconds.length > 0

    this._processGaEachSeconds = Number.isInteger(cfg.progressEachSeconds) && cfg.progressEachSeconds > 0
    this._gaEachSeconds = this._processGaEachSeconds && cfg.progressEachSeconds || false
    this._gaEachSecondsCat = cfg.progressEachSecondsCategory || this._category
    this._gaEachSecondsAct = $.isFunction(cfg.progressEachSecondsAction) && cfg.progressEachSecondsAction || function(i) { return 'progress_' + i + 's' }
  }

  get _defaultEventMap() {
    return {
      'ready': 'ready',
      'buffering': 'buffering',
      'bufferfull': 'bufferfull',
      'loadedmetadata': 'loadedmetadata',
      'play': 'play',
      'seek': 'seek',
      'pause': 'pause',
      'stop': 'stop',
      'ended': 'ended',
      'volume': 'volume',
      'fullscreen': 'fullscreen',
      'error': 'error',
      'playbackstate': 'playbackstate',
      'highdefinitionupdate': 'highdefinitionupdate',
      'playbackdvrstatechanged': 'playbackdvrstatechanged'
    }
  }

  get _defaultEvents() {
    return [
      'play',
      'seek',
      'pause',
      'stop',
      'ended',
      'volume'
    ]
  }

  _hasEvent(e) {
    return this._events.indexOf(e) !== -1
  }

  _action(e, v) {
    return $.isFunction(this._eventMap[e])
      ? this._eventMap[e](v)
      : this._eventMap[e]
  }

  _value(v) {
    if (this._setValue) return v // else return undefined
  }

  get position() {
    return this._isLive ? 0 : this._position
  }

  get duration() {
    return this._isLive ? 0 : this.__container && this.__container.getDuration()
  }

  get isPlaying() {
    return this.__container.isPlaying()
  }

  trunc(v) {
    return parseInt(v, 10)
  }

  onSettingsUpdate() {
    // Type may change while playing
    this._isLive = this.__container.getPlaybackType() === Playback.LIVE
  }

  onTimeUpdate(o) {
    this._position = o.current && this.trunc(o.current) || 0

    if (this._isLive || !this.isPlaying) return

    // Check for "seconds" progress events
    this._processGaSeconds && this.processGaSeconds(this._position)
    this._processGaEachSeconds && this.processGaEachSeconds(this._position)

    // Check for "percent" progress event
    this._processGaPercent && this.processGaPercent(this._position)
  }

  processGaSeconds(pos) {
    if (this._gaSecondsPrev !== pos && this._gaSeconds.indexOf(pos) !== -1) {
      this._gaSecondsPrev = pos
      this.gaEvent(this._gaSecondsCat, this._gaSecondsAct(pos), this._label, this._value(pos))
    }
  }

  processGaEachSeconds(pos) {
    if (pos > 0 && this._gaEachSecondsPrev !== pos && pos % this._gaEachSeconds === 0) {
      this._gaEachSecondsPrev = pos
      this.gaEvent(this._gaSecondsCat, this._gaEachSecondsAct(pos), this._label, this._value(pos))
    }
  }

  processGaPercent(pos) {
    let percent = this.duration > 0 ? this.trunc((pos * 100) / this.duration) : 0
    $.each(this._gaPercent, (i, v) => {
      // Percentage value may never match expected value. To fix that, we compare to previous and current.
      // This introduce a small approximation, but this function is called multiples time per seconds.
      if (this._gaPercentPrev < v && percent >= v) {
        this.gaEvent(this._gaPercentCat, this._gaPercentAct(v), this._label, this._value(v))

        return false
      }
    })
    this._gaPercentPrev = percent
  }

  onReady() {
    this.gaEvent(this._category, this._action('ready'), this._label)
  }

  onBuffering() {
    this.gaEvent(this._category, this._action('buffering'), this._label)
  }

  onBufferFull() {
    this.gaEvent(this._category, this._action('bufferfull'), this._label)
  }

  onLoadedMetadata(metadata) {
    this.gaEvent(this._category, this._action('loadedmetadata', metadata), this._label)
  }

  onPlay() {
    if (this._gaPlayOnce) {
      if (!this._doSendPlay) return
      this._doSendPlay = false
    }

    let pos = this._asLive ? 0 : this.position
    this._hasEvent('play') && this.gaEvent(this._category, this._action('play', pos), this._label, this._value(pos))

    this._withProgressTimer && this._startProgressTimer()
  }

  get _withProgressTimer() {
    // Assumed as LIVE playback type and at least one option enabled
    return (this._isLive || this._asLive) && (this._processGaSeconds || this._processGaEachSeconds || this._setValue)
  }

  _startProgressTimer() {
    if (this._progressTimerStarted) return

    this._progressTimerStarted = true
    this._progressTimerElapsed = 0

    // "on demand" is processed in onTimeUpdate()
    this._isLive && this._processGaSeconds && this.processGaSeconds(this._progressTimerElapsed)
    this._isLive && this._processGaEachSeconds && this.processGaEachSeconds(this._progressTimerElapsed)

    this._progressTimerId = setInterval(() => {
      this._progressTimerElapsed++
      if (this.isPlaying) {
        this._isLive && this._processGaSeconds && this.processGaSeconds(this._progressTimerElapsed)
        this._isLive && this._processGaEachSeconds && this.processGaEachSeconds(this._progressTimerElapsed)
      }
    }, 1000)
  }

  _stopProgressTimer() {
    clearInterval(this._progressTimerId)
    this._gaSecondsPrev = -1
    this._gaEachSecondsPrev = -1
    this._progressTimerStarted = false
  }

  onSeek(toPos) {
    // FIXME: value may be unexpected for LIVE playback with DVR
    let pos = this.trunc(toPos)
    this._hasEvent('seek') && this.gaEvent(this._category, this._action('seek', pos), this._label, this._value(pos))
    if (this._gaPlayOnce) this._doSendPlay = true

    // Adjust previous "percent" event value
    if (!this._isLive && this._processGaPercent) {
      this._gaPercentPrev = this.trunc((pos * 100) / this.duration) - 1
    }

    this._withProgressTimer && this._stopProgressTimer()
  }

  onPause() {
    let pos = this._isLive || this._asLive ? this._progressTimerElapsed : this.position
    this._hasEvent('pause') && this.gaEvent(this._category, this._action('pause', pos), this._label, this._value(pos))
    if (this._gaPlayOnce) this._doSendPlay = true

    this._withProgressTimer && this._stopProgressTimer()
  }

  onStop() {
    let pos = this._isLive || this._asLive ? this._progressTimerElapsed : this.position
    this._hasEvent('stop') && this.gaEvent(this._category, this._action('stop', this.position), this._label, this._value(pos))
    if (this._gaPlayOnce) this._doSendPlay = true

    this._withProgressTimer && this._stopProgressTimer()
  }

  onEnded() {
    let pos = this._isLive ? this._progressTimerElapsed : this.position
    this._hasEvent('ended') && this.gaEvent(this._category, this._action('ended', pos), this._label, this._value(pos))
    if (this._gaPlayOnce) this._doSendPlay = true

    // Check for video ended progress events
    this._processGaSeconds && this.processGaSeconds(this.duration)
    this._processGaEachSeconds && this.processGaEachSeconds(this.duration)
    this._processGaPercent && this.processGaPercent(this.duration)
  }

  onVolumeChanged(percent) {
    // Rate limit to avoid HTTP hammering
    clearTimeout(this._volumeTimer)
    this._volumeTimer = setTimeout(() => {
      this.gaEvent(this._category, this._action('volume', this.trunc(percent)), this._label, this._value(this.trunc(percent)))
    }, 400)
  }

  onCoreFullscreen(isFullscreen) {
    let v = isFullscreen ? 1 : 0
    this.gaEvent(this._category, this._action('fullscreen'), this._label, this._value(v))
  }

  onPlaybackChanged(playbackState) {
    this.gaEvent(this._category, this._action('playbackstate'), this._label)
  }

  onHD(isHD) {
    let v = isHD ? 1 : 0
    this.gaEvent(this._category, this._action('highdefinitionupdate'), this._label, this._value(v))
  }

  onDVR(dvrInUse) {
    let v = dvrInUse ? 1 : 0
    this.gaEvent(this._category, this._action('playbackdvrstatechanged'), this._label, this._value(v))
  }

  resolveErrMsg(o) {
    if (!this._gaExDesc) {
      return 'error'
    }

    let msg
    if (typeof o.error === 'string') {
      msg = o.error
    } else if ($.isPlainObject(o.error) && o.error.message) {
      msg = o.error.message
    } else {
      // FIXME: find out a more elegant way
      msg = 'Error: ' + o.error
    }

    return msg
  }

  onError(errorObj) {
    if (this._gaEx) {
      this.gaException(this.resolveErrMsg(errorObj), true)
    } else {
      this.gaEvent(this._category, this._action('error'), this._label)
    }
  }

  stopOnLeave() {
    if (this._stopOnLeaveEvent) return

    this._stopOnLeave = e => {
      if (!this.isPlaying) {
        return
      }

      this._gaBeacon = true

      // Event listener method is directly called on iOS devices
      // because "pagehide" event is too short to stop player
      if (this._isLive) {
        this._isIos && this.onStop() || this.__container.stop()
      } else {
        this._isIos && this.onPause() || this.__container.pause()
      }
    }

    this._stopOnLeaveEvent = this._isIos ? 'pagehide' : 'beforeunload'

    window.addEventListener(this._stopOnLeaveEvent, this._stopOnLeave)
  }

  destroy() {
    if (this._stopOnLeave) {
      window.removeEventListener(this._stopOnLeaveEvent, this._stopOnLeave)
      this._stopOnLeave = null
    }
    super.destroy()
  }
}
