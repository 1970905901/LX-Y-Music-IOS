// Patch dependency sources after install when upstream packages need local integration fixes.

const fs = require('node:fs')
const path = require('node:path')

const rootPath = __dirname
const equalizerAudioMixSwiftSource = fs.readFileSync(path.join(rootPath, 'patches/ios/LXEqualizerAudioMix.swift'), 'utf8')
const sharedIRKernelSource = fs.readFileSync(path.join(rootPath, 'ios/LxMusicMobile/LXSharedIRConvolutionKernel.hpp'), 'utf8')
const sharedIRBridgeHeaderSource = fs.readFileSync(path.join(rootPath, 'patches/ios/LXSharedIRConvolutionBridge.h'), 'utf8')
const sharedIRBridgeSource = fs.readFileSync(path.join(rootPath, 'patches/ios/LXSharedIRConvolutionBridge.mm'), 'utf8')

/**
 * @typedef {{ from: string, to: string }} PatchChange
 * @typedef {{ filePath: string, changes: PatchChange[] }} PatchTarget
 */

/** @type {PatchTarget[]} */
const patchTargets = [
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `import Foundation
import MediaPlayer
import SwiftAudioEx

@objc(RNTrackPlayer)
public class RNTrackPlayer: RCTEventEmitter {
`,
        to: `import Foundation
import MediaPlayer
import SwiftAudioEx

private let lxTrackPlayerLifecycleNotification = Notification.Name("LXTrackPlayerLifecycle")

@objc(RNTrackPlayer)
public class RNTrackPlayer: RCTEventEmitter {
`,
      },
      {
        from: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()

    // MARK: - Lifecycle Methods
`,
        to: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()

    private func lifecycleStateName(_ state: AVPlayerWrapperState) -> String {
        switch state {
        case .idle: return "idle"
        case .ready: return "ready"
        case .playing: return "playing"
        case .paused: return "paused"
        case .loading: return "loading"
        default: return "unknown"
        }
    }

    private func postLifecycleEvent(_ event: String, state: AVPlayerWrapperState? = nil, position: Double? = nil, rate: Float? = nil, extra: [String: Any] = [:]) {
        var userInfo = extra
        let lifecycleState = state ?? player.playerState
        userInfo["event"] = event
        userInfo["state"] = lifecycleStateName(lifecycleState)
        userInfo["position"] = position ?? player.currentTime
        userInfo["rate"] = rate ?? player.rate
        userInfo["track"] = player.currentIndex

        NotificationCenter.default.post(name: lxTrackPlayerLifecycleNotification, object: self, userInfo: userInfo)
    }

    // MARK: - Lifecycle Methods
`,
      },
      {
        from: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        self.player.nowPlayingInfoController.clear()
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
        to: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
      },
      {
        from: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
        to: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
      },
      {
        from: `    @objc(seekTo:resolver:rejecter:)
    public func seek(to time: Double, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Seeking to \\(time) seconds")
        player.seek(to: time)
        resolve(NSNull())
    }
`,
        to: `    @objc(seekTo:resolver:rejecter:)
    public func seek(to time: Double, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Seeking to \\(time) seconds")
        player.seek(to: time)
        postLifecycleEvent("seek", position: time)
        resolve(NSNull())
    }
`,
      },
      {
        from: `    @objc(stop:rejecter:)
    public func stop(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Stopping playback")
        player.stop()
        resolve(NSNull())
    }
`,
        to: `    @objc(stop:rejecter:)
    public func stop(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Stopping playback")
        player.stop()
        postLifecycleEvent("stop", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
    }
`,
      },
      {
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
    }
`,
        to: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
      },
      {
        from: `    func handleAudioPlayerFailed(error: Error?) {
        sendEvent(withName: "playback-error", body: ["error": error?.localizedDescription])
    }
`,
        to: `    func handleAudioPlayerFailed(error: Error?) {
        sendEvent(withName: "playback-error", body: ["error": error?.localizedDescription])
        postLifecycleEvent("error", extra: ["error": error?.localizedDescription ?? ""])
    }
`,
      },
      {
        from: `        var capabilitiesStr = options["capabilities"] as? [String] ?? []
        if (capabilitiesStr.contains("play") && capabilitiesStr.contains("pause")) {
            capabilitiesStr.append("togglePlayPause");
        }
        let capabilities = capabilitiesStr.compactMap { Capability(rawValue: $0) }
`,
        to: `        let capabilitiesStr = options["capabilities"] as? [String] ?? []
        let capabilities = capabilitiesStr.compactMap { Capability(rawValue: $0) }
`,
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `import Foundation
import MediaPlayer
import SwiftAudioEx

private let lxTrackPlayerLifecycleNotification = Notification.Name("LXTrackPlayerLifecycle")
`,
        to: `import Foundation
import AVFoundation
import MediaPlayer
import SwiftAudioEx

private let lxTrackPlayerLifecycleNotification = Notification.Name("LXTrackPlayerLifecycle")
`,
      },
      {
        from: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()

    private func lifecycleStateName(_ state: AVPlayerWrapperState) -> String {
`,
        to: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()
    private var equalizerEnabled = false
    private var equalizerGains = LXEqualizerAudioMixController.normalizeGains([])
    private var equalizerTapProcessor: LXEqualizerAudioMixController?
    private weak var equalizedPlayerItem: AVPlayerItem?

    private func lifecycleStateName(_ state: AVPlayerWrapperState) -> String {
`,
      },
      {
        from: `    deinit {
        reset(resolve: { _ in }, reject: { _, _, _  in })
    }
`,
        to: `    deinit {
        NotificationCenter.default.removeObserver(self, name: lxSoundEffectConfigNotification, object: nil)
        reset(resolve: { _ in }, reject: { _, _, _  in })
    }
`,
      },
      {
        from: `        setupInterruptionHandling();

        // configure if player waits to play
`,
        to: `        setupInterruptionHandling();
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleSoundEffectConfigChanged),
                                               name: lxSoundEffectConfigNotification,
                                               object: nil)

        // configure if player waits to play
`,
      },
      {
        from: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
        to: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        equalizedPlayerItem = nil
        equalizerTapProcessor = nil
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
      },
      {
        from: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
        to: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        equalizedPlayerItem = nil
        equalizerTapProcessor = nil
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
      },
      {
        from: `    @objc(updateNowPlayingMetadata:resolver:rejecter:)
    public func updateNowPlayingMetadata(metadata: [String: Any], resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        Metadata.update(for: player, with: metadata)
    }

    // MARK: - QueuedAudioPlayer Event Handlers
`,
        to: `    @objc(updateNowPlayingMetadata:resolver:rejecter:)
    public func updateNowPlayingMetadata(metadata: [String: Any], resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        Metadata.update(for: player, with: metadata)
    }

    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        applySoundEffectConfig(notification.userInfo)
        refreshEqualizerAudioMix()
    }

    private func applySoundEffectConfig(_ userInfo: [AnyHashable: Any]?) {
        equalizerEnabled = userInfo?["enabled"] as? Bool ?? false
        let inputGains = userInfo?["gains"] as? [NSNumber] ?? []
        equalizerGains = LXEqualizerAudioMixController.normalizeGains(inputGains.map { $0.floatValue })
        equalizerTapProcessor?.updateConfig(enabled: equalizerEnabled, gains: equalizerGains)
    }

    private func refreshEqualizerAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        if equalizedPlayerItem === currentItem, let processor = equalizerTapProcessor {
            processor.updateConfig(enabled: equalizerEnabled, gains: equalizerGains)
            return
        }

        guard equalizerEnabled else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(enabled: equalizerEnabled, gains: equalizerGains)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        equalizedPlayerItem = currentItem
        equalizerTapProcessor = processor
    }

    // MARK: - QueuedAudioPlayer Event Handlers
`,
      },
      {
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
        to: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshEqualizerAudioMix()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
      },
      {
        from: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
        to: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshEqualizerAudioMix()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()
    private var equalizerEnabled = false
    private var equalizerGains = LXEqualizerAudioMixController.normalizeGains([])
    private var equalizerTapProcessor: LXEqualizerAudioMixController?
    private weak var equalizedPlayerItem: AVPlayerItem?
`,
        to: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()
    private var soundEffectConfig = LXSoundEffectConfiguration()
    private var soundEffectTapProcessor: LXEqualizerAudioMixController?
    private weak var soundEffectPlayerItem: AVPlayerItem?
`,
      },
      {
        from: `        self.player.stop()
        equalizedPlayerItem = nil
        equalizerTapProcessor = nil
        self.player.nowPlayingInfoController.clear()
`,
        to: `        self.player.stop()
        soundEffectPlayerItem?.audioMix = nil
        soundEffectPlayerItem = nil
        soundEffectTapProcessor = nil
        self.player.nowPlayingInfoController.clear()
`,
      },
      {
        from: `        player.stop()
        equalizedPlayerItem = nil
        equalizerTapProcessor = nil
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
`,
        to: `        player.stop()
        soundEffectPlayerItem?.audioMix = nil
        soundEffectPlayerItem = nil
        soundEffectTapProcessor = nil
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
`,
      },
      {
        from: `    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        applySoundEffectConfig(notification.userInfo)
        refreshEqualizerAudioMix()
    }

    private func applySoundEffectConfig(_ userInfo: [AnyHashable: Any]?) {
        equalizerEnabled = userInfo?["enabled"] as? Bool ?? false
        let inputGains = userInfo?["gains"] as? [NSNumber] ?? []
        equalizerGains = LXEqualizerAudioMixController.normalizeGains(inputGains.map { $0.floatValue })
        equalizerTapProcessor?.updateConfig(enabled: equalizerEnabled, gains: equalizerGains)
    }

    private func refreshEqualizerAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        if equalizedPlayerItem === currentItem, let processor = equalizerTapProcessor {
            processor.updateConfig(enabled: equalizerEnabled, gains: equalizerGains)
            return
        }

        guard equalizerEnabled else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(enabled: equalizerEnabled, gains: equalizerGains)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        equalizedPlayerItem = currentItem
        equalizerTapProcessor = processor
    }
`,
        to: `    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        let nextConfig = LXSoundEffectConfiguration.fromUserInfo(notification.userInfo)
        if Thread.isMainThread {
            soundEffectConfig = nextConfig
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.soundEffectConfig = nextConfig
            self?.refreshSoundEffectAudioMix()
        }
    }

    private func refreshSoundEffectAudioMixOnMainThread() {
        if Thread.isMainThread {
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.refreshSoundEffectAudioMix()
        }
    }

    private func refreshSoundEffectAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        if soundEffectPlayerItem !== currentItem {
            soundEffectPlayerItem?.audioMix = nil
        }

        if let processor = soundEffectTapProcessor, soundEffectPlayerItem === currentItem {
            processor.updateConfig(soundEffectConfig)
            if soundEffectConfig.isActive {
                if currentItem.audioMix == nil, let audioMix = processor.makeAudioMix(for: currentItem.asset) {
                    currentItem.audioMix = audioMix
                }
            } else {
                currentItem.audioMix = nil
                soundEffectTapProcessor = nil
                soundEffectPlayerItem = nil
            }
            return
        }

        guard soundEffectConfig.isActive else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(config: soundEffectConfig)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        soundEffectPlayerItem = currentItem
        soundEffectTapProcessor = processor
    }
`,
      },
      {
        from: `    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        soundEffectConfig = LXSoundEffectConfiguration.fromUserInfo(notification.userInfo)
        soundEffectTapProcessor?.updateConfig(soundEffectConfig)
        refreshSoundEffectAudioMix()
    }

    private func refreshSoundEffectAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        if soundEffectPlayerItem !== currentItem {
            soundEffectPlayerItem?.audioMix = nil
        }

        if let processor = soundEffectTapProcessor, soundEffectPlayerItem === currentItem {
            processor.updateConfig(soundEffectConfig)
            if soundEffectConfig.isActive {
                if currentItem.audioMix == nil, let audioMix = processor.makeAudioMix(for: currentItem.asset) {
                    currentItem.audioMix = audioMix
                }
            } else {
                currentItem.audioMix = nil
                soundEffectTapProcessor = nil
                soundEffectPlayerItem = nil
            }
            return
        }

        guard soundEffectConfig.isActive else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(config: soundEffectConfig)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        soundEffectPlayerItem = currentItem
        soundEffectTapProcessor = processor
    }
`,
        to: `    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        soundEffectConfig = LXSoundEffectConfiguration.fromUserInfo(notification.userInfo)
        refreshSoundEffectAudioMix()
    }

    private func refreshSoundEffectAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        if soundEffectPlayerItem !== currentItem {
            soundEffectPlayerItem?.audioMix = nil
        }

        if let processor = soundEffectTapProcessor, soundEffectPlayerItem === currentItem {
            processor.updateConfig(soundEffectConfig)
            if soundEffectConfig.isActive {
                if currentItem.audioMix == nil, let audioMix = processor.makeAudioMix(for: currentItem.asset) {
                    currentItem.audioMix = audioMix
                }
            } else {
                currentItem.audioMix = nil
                soundEffectTapProcessor = nil
                soundEffectPlayerItem = nil
            }
            return
        }

        guard soundEffectConfig.isActive else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(config: soundEffectConfig)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        soundEffectPlayerItem = currentItem
        soundEffectTapProcessor = processor
    }
`,
      },
      {
        from: `    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        soundEffectConfig = LXSoundEffectConfiguration.fromUserInfo(notification.userInfo)
        refreshSoundEffectAudioMix()
    }

    private func refreshSoundEffectAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        if soundEffectPlayerItem !== currentItem {
            soundEffectPlayerItem?.audioMix = nil
        }

        if let processor = soundEffectTapProcessor, soundEffectPlayerItem === currentItem {
            processor.updateConfig(soundEffectConfig)
            if soundEffectConfig.isActive {
                if currentItem.audioMix == nil, let audioMix = processor.makeAudioMix(for: currentItem.asset) {
                    currentItem.audioMix = audioMix
                }
            } else {
                currentItem.audioMix = nil
                soundEffectTapProcessor = nil
                soundEffectPlayerItem = nil
            }
            return
        }

        guard soundEffectConfig.isActive else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(config: soundEffectConfig)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        soundEffectPlayerItem = currentItem
        soundEffectTapProcessor = processor
    }
`,
        to: `    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        let nextConfig = LXSoundEffectConfiguration.fromUserInfo(notification.userInfo)
        if Thread.isMainThread {
            soundEffectConfig = nextConfig
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.soundEffectConfig = nextConfig
            self?.refreshSoundEffectAudioMix()
        }
    }

    private func refreshSoundEffectAudioMixOnMainThread() {
        if Thread.isMainThread {
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.refreshSoundEffectAudioMix()
        }
    }

    private func refreshSoundEffectAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        if soundEffectPlayerItem !== currentItem {
            soundEffectPlayerItem?.audioMix = nil
        }

        if let processor = soundEffectTapProcessor, soundEffectPlayerItem === currentItem {
            processor.updateConfig(soundEffectConfig)
            if soundEffectConfig.isActive {
                if currentItem.audioMix == nil, let audioMix = processor.makeAudioMix(for: currentItem.asset) {
                    currentItem.audioMix = audioMix
                }
            } else {
                currentItem.audioMix = nil
                soundEffectTapProcessor = nil
                soundEffectPlayerItem = nil
            }
            return
        }

        guard soundEffectConfig.isActive else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(config: soundEffectConfig)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        soundEffectPlayerItem = currentItem
        soundEffectTapProcessor = processor
    }
`,
      },
      {
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshEqualizerAudioMix()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
        to: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshSoundEffectAudioMixOnMainThread()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
      },
      {
        from: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshEqualizerAudioMix()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
        to: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshSoundEffectAudioMixOnMainThread()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
      },
      {
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshSoundEffectAudioMix()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
        to: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshSoundEffectAudioMixOnMainThread()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
      },
      {
        from: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshSoundEffectAudioMix()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
        to: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshSoundEffectAudioMixOnMainThread()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        // mixWithOthers 需要 .default 路由策略才能生效：longFormAudio 是“独占式长音频”策略，
        // 会忽略混音选项，导致“关闭其他应用播放时自动暂停”设置下音乐仍被系统中断。
        // 仅在未请求混音时沿用 longFormAudio（保留 CarPlay 等长音频路由）。
        from: `        // Progressively opt into AVAudioSession policies for background audio
        // and AirPlay 2.
        if #available(iOS 13.0, *) {
            try? AVAudioSession.sharedInstance().setCategory(sessionCategory, mode: sessionCategoryMode, policy: sessionCategory == .ambient ? .default : .longFormAudio, options: sessionCategoryOptions)
        } else if #available(iOS 11.0, *) {
            try? AVAudioSession.sharedInstance().setCategory(sessionCategory, mode: sessionCategoryMode, policy: sessionCategory == .ambient ? .default : .longForm, options: sessionCategoryOptions)
        } else {
            try? AVAudioSession.sharedInstance().setCategory(sessionCategory, mode: sessionCategoryMode, options: sessionCategoryOptions)
        }`,
        to: `        // mixWithOthers 需要 .default 路由策略才能生效：longFormAudio 是“独占式长音频”策略，
        // 会忽略混音选项，导致“关闭其他应用播放时自动暂停”设置下音乐仍被系统中断。
        // 仅在未请求混音时沿用 longFormAudio（保留 CarPlay 等长音频路由）。
        let useLongFormAudioPolicy = sessionCategory != .ambient && !sessionCategoryOptions.contains(.mixWithOthers)
        // Progressively opt into AVAudioSession policies for background audio
        // and AirPlay 2.
        if #available(iOS 13.0, *) {
            try? AVAudioSession.sharedInstance().setCategory(sessionCategory, mode: sessionCategoryMode, policy: useLongFormAudioPolicy ? .longFormAudio : .default, options: sessionCategoryOptions)
        } else if #available(iOS 11.0, *) {
            try? AVAudioSession.sharedInstance().setCategory(sessionCategory, mode: sessionCategoryMode, policy: useLongFormAudioPolicy ? .longForm : .default, options: sessionCategoryOptions)
        } else {
            try? AVAudioSession.sharedInstance().setCategory(sessionCategory, mode: sessionCategoryMode, options: sessionCategoryOptions)
        }`,
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/react-native-track-player.podspec',
    changes: [
      {
        from: '  s.source_files = "ios/**/*.{h,m,swift}"',
        to: '  s.source_files = "ios/**/*.{h,m,mm,swift}"',
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/Support/RNTrackPlayer-Bridging-Header.h',
    changes: [
      {
        from: `#import <React/RCTConvert.h>
`,
        to: `#import <React/RCTConvert.h>
#import "LXSharedIRConvolutionBridge.h"
`,
      },
    ],
  },
]

const patchFile = async({ filePath, changes }) => {
  const resolvedPath = path.join(rootPath, filePath)
  console.log(`Patching ${filePath}`)

  const file = await fs.promises.readFile(resolvedPath, 'utf8')
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  let normalizedFile = file.replace(/\r\n/g, '\n')
  const originalFile = normalizedFile

  for (const { from, to } of changes) {
    if (normalizedFile.includes(to)) continue
    if (!normalizedFile.includes(from)) continue
    normalizedFile = normalizedFile.replace(from, to)
  }

  if (normalizedFile != originalFile) await fs.promises.writeFile(resolvedPath, normalizedFile.replace(/\n/g, eol))
}

const walkFiles = async(dirPath, visitor) => {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) await walkFiles(entryPath, visitor)
    else await visitor(entryPath)
  }
}

const findFile = async(dirPath, fileName) => {
  let matchedPath = null
  await walkFiles(dirPath, async(filePath) => {
    if (matchedPath || path.basename(filePath) != fileName) return
    matchedPath = filePath
  })
  return matchedPath
}

const patchFileByRegex = async({ filePath, pattern, replacement }) => {
  const resolvedPath = path.join(rootPath, filePath)
  console.log(`Patching ${filePath}`)

  const file = await fs.promises.readFile(resolvedPath, 'utf8')
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  const normalizedFile = file.replace(/\r\n/g, '\n')
  if (normalizedFile.includes(replacement.trim())) return
  const nextFile = normalizedFile.replace(pattern, replacement)

  if (nextFile == normalizedFile) throw new Error('Patch pattern not found')
  if (nextFile != normalizedFile) await fs.promises.writeFile(resolvedPath, nextFile.replace(/\n/g, eol))
}

const ensureFileContent = async({ filePath, content }) => {
  const resolvedPath = path.join(rootPath, filePath)
  console.log(`Ensuring ${filePath}`)

  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true })
  const file = await fs.promises.readFile(resolvedPath, 'utf8').catch(() => '')
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  const normalizedFile = file.replace(/\r\n/g, '\n')
  const normalizedContent = content.replace(/\r\n/g, '\n')

  if (normalizedFile == normalizedContent) return
  await fs.promises.writeFile(resolvedPath, normalizedContent.replace(/\n/g, eol))
}

const patchSwiftAudioSeek = async() => {
  const baseDir = path.join(rootPath, 'node_modules/react-native-track-player/ios/RNTrackPlayer')
  if (!fs.existsSync(baseDir)) {
    console.log('Skip SwiftAudio seek patch: react-native-track-player source not found')
    return
  }
  const wrapperPath = await findFile(baseDir, 'AVPlayerWrapper.swift')
  if (!wrapperPath) {
    console.log('Skip SwiftAudio seek patch: AVPlayerWrapper.swift not found')
    return
  }

  const relativePath = path.relative(rootPath, wrapperPath)
  await patchFileByRegex({
    filePath: relativePath,
    pattern: /func seek\(to seconds: TimeInterval\) \{[\s\S]*?func seek\(by seconds: TimeInterval\) \{/,
    replacement: `func seek(to seconds: TimeInterval) {
        // if the player is loading then we need to defer seeking until it's ready.
        if (avPlayer.currentItem == nil) {
            timeToSeekToAfterLoading = seconds
        } else {
            let time = CMTimeMakeWithSeconds(seconds, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
            let performSeek = { [weak self] (completion: @escaping (Bool) -> Void) in
                guard let self = self else {
                    completion(false)
                    return
                }
                self.currentItem?.cancelPendingSeeks()
                self.avPlayer.seek(to: time, toleranceBefore: CMTime.zero, toleranceAfter: CMTime.zero, completionHandler: completion)
            }

            performSeek { [weak self] finished in
                guard let self = self else { return }
                let currentTime = self.avPlayer.currentTime().seconds
                if finished && !currentTime.isNaN && abs(currentTime - seconds) > 0.2 {
                    performSeek { [weak self] retryFinished in
                        guard let self = self else { return }
                        self.delegate?.AVWrapper(seekTo: Double(seconds), didFinish: retryFinished)
                    }
                    return
                }
                self.delegate?.AVWrapper(seekTo: Double(seconds), didFinish: finished)
            }
        }
    }
    func seek(by seconds: TimeInterval) {`,
  })
}

const patchTrackPlayerSoundEffectRefresh = async() => {
  const filePath = 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift'

  await patchFileByRegex({
    filePath,
    pattern: /@objc private func handleSoundEffectConfigChanged\(_ notification: Notification\) \{[\s\S]*?\n\s{4}\/\/ MARK: - QueuedAudioPlayer Event Handlers/,
    replacement: `@objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        let nextConfig = LXSoundEffectConfiguration.fromUserInfo(notification.userInfo)
        if Thread.isMainThread {
            soundEffectConfig = nextConfig
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.soundEffectConfig = nextConfig
            self?.refreshSoundEffectAudioMix()
        }
    }

    private func refreshSoundEffectAudioMixOnMainThread() {
        if Thread.isMainThread {
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.refreshSoundEffectAudioMix()
        }
    }

    private func refreshSoundEffectAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        if soundEffectPlayerItem !== currentItem {
            soundEffectPlayerItem?.audioMix = nil
        }

        if let processor = soundEffectTapProcessor, soundEffectPlayerItem === currentItem {
            processor.updateConfig(soundEffectConfig)
            if soundEffectConfig.isActive {
                if currentItem.audioMix == nil, let audioMix = processor.makeAudioMix(for: currentItem.asset) {
                    currentItem.audioMix = audioMix
                }
            } else {
                currentItem.audioMix = nil
                soundEffectTapProcessor = nil
                soundEffectPlayerItem = nil
            }
            return
        }

        guard soundEffectConfig.isActive else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(config: soundEffectConfig)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            currentItem.audioMix = nil
            soundEffectPlayerItem = nil
            soundEffectTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        soundEffectPlayerItem = currentItem
        soundEffectTapProcessor = processor
    }

    // MARK: - QueuedAudioPlayer Event Handlers`,
  })

  await patchFileByRegex({
    filePath,
    pattern: /func handleAudioPlayerStateChange\(state: AVPlayerWrapperState\) \{[\s\S]*?\n\s{4}\}/,
    replacement: `func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshSoundEffectAudioMixOnMainThread()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }`,
  })

  await patchFileByRegex({
    filePath,
    pattern: /func handleAudioPlayerQueueIndexChange\(previousIndex: Int\?, nextIndex: Int\?\) \{[\s\S]*?\n\s{8}var dictionary: \[String: Any\] = \[ "position": player.currentTime \]/,
    replacement: `func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshSoundEffectAudioMixOnMainThread()
        var dictionary: [String: Any] = [ "position": player.currentTime ]`,
  })
}

;(async() => {
  for (const target of patchTargets) {
    try {
      await patchFile(target)
    } catch (err) {
      console.error(`Patch ${target.filePath} failed: ${err.message}`)
    }
  }
  try {
    await patchSwiftAudioSeek()
  } catch (err) {
    console.error(`Patch SwiftAudio seek failed: ${err.message}`)
  }
  try {
    await patchTrackPlayerSoundEffectRefresh()
  } catch (err) {
    console.error(`Patch TrackPlayer sound effect refresh failed: ${err.message}`)
  }
  try {
    await ensureFileContent({
      filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/LXEqualizerAudioMix.swift',
      content: equalizerAudioMixSwiftSource,
    })
  } catch (err) {
    console.error(`Ensure LXEqualizerAudioMix.swift failed: ${err.message}`)
  }
  try {
    await ensureFileContent({
      filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/LXSharedIRConvolutionKernel.hpp',
      content: sharedIRKernelSource,
    })
    await ensureFileContent({
      filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/LXSharedIRConvolutionBridge.h',
      content: sharedIRBridgeHeaderSource,
    })
    await ensureFileContent({
      filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/LXSharedIRConvolutionBridge.mm',
      content: sharedIRBridgeSource,
    })
  } catch (err) {
    console.error(`Ensure shared IR bridge failed: ${err.message}`)
  }
  console.log('\nDependencies patch finished.\n')
})()
