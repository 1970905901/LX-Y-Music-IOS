// Patch dependency sources after install when upstream packages need local integration fixes.

const fs = require('node:fs')
const path = require('node:path')

const rootPath = __dirname
const equalizerAudioMixSwiftSource = fs.readFileSync(path.join(rootPath, 'patches/ios/LXEqualizerAudioMix.swift'), 'utf8')
const sharedIRKernelSource = fs.readFileSync(path.join(rootPath, 'ios/LxMusicMobile/LXSharedIRConvolutionKernel.hpp'), 'utf8')
const sharedIRBridgeHeaderSource = fs.readFileSync(path.join(rootPath, 'patches/ios/LXSharedIRConvolutionBridge.h'), 'utf8')
const sharedIRBridgeSource = fs.readFileSync(path.join(rootPath, 'patches/ios/LXSharedIRConvolutionBridge.mm'), 'utf8')

/**
 * @typedef {{ from: string, to: string, optional?: boolean }} PatchChange
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
        // 旧 equalizer 属性块 → soundEffect 属性块：仅「曾应用旧补丁」的本机 node_modules 需要，缺失属正常。
        // 这里必须整段替换而不是「先删后插」：patchFile 的已应用判定会拿 to 去 includes，
        // 删除形态（to 是 from 的子串）必然命中而静默跳过。
        optional: true,
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
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()
`,
        to: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()
    private var soundEffectConfig = LXSoundEffectConfiguration()
    private var soundEffectTapProcessor: LXEqualizerAudioMixController?
    private weak var soundEffectPlayerItem: AVPlayerItem?
`,
      },
      {
        optional: true,
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
        // 全新安装（CI / npm ci / 新机器）：上游源码里没有 sound effect 清理，需要补齐；
        // 已应用过的机器会命中上面可选迁移的 to，或本段 to 的逐字匹配而跳过。
        from: `        self.player.stop()
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
        optional: true,
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
        // 全新安装：reset 里同样缺少释放 audioMix 的步骤（与 destroy 对称）。
        from: `        player.stop()
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
        optional: true,
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
        optional: true,
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
        // 全新安装：上游基线里 stateChange / queueIndexChange 没有音效刷新调用；
        // 旧机器由上面的 optional 迁移负责，跑到这里时 to 已存在而跳过。
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
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
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
        to: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshSoundEffectAudioMixOnMainThread()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
      },
      {
        // 全新安装：上游源码里根本没有 soundEffect handler（而 target#2 已注册了 selector），
        // 必须按 marker 位置补齐 v2 实现，否则运行时 selector 找不到方法会崩。
        from: `    // MARK: - QueuedAudioPlayer Event Handlers
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

    // MARK: - QueuedAudioPlayer Event Handlers
`,
      },
      {
        optional: true,
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
        optional: true,
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
        optional: true,
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
        optional: true,
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
        // 仅在未请求混音时沿用 longFormAudio（保留长音频路由）。
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
        // 仅在未请求混音时沿用 longFormAudio（保留长音频路由）。
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
      {
        from: `        player.event.queueIndex.addListener(self, handleAudioPlayerQueueIndexChange)
    }
`,
        to: `        player.event.queueIndex.addListener(self, handleAudioPlayerQueueIndexChange)
        // ≈ HTMLMediaElement 的 seeked：AVPlayer seek completion（引擎真正到达落点，
        // 无论是否经历缓冲）。发起时的 "seek" lifecycle 事件带请求目标；本事件带引擎
        // 真实落点，控制中心歌词时钟据此精确重锚，并转发 JS 触发歌词重锚。
        player.event.seek.addListener(self, handleAudioPlayerSeekCompleted)
    }
`,
      },
      {
        from: '    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {',
        to: `    // ≈ HTMLMediaElement 的 seeked：seek completion 回调（SeekEventData = (seconds: Int, didFinish: Bool)）。
    // 同时发 lifecycle 通知（控制中心歌词时钟重锚到真实落点）与 JS 事件（歌词重锚触发）。
    private func handleAudioPlayerSeekCompleted(_ data: (seconds: Int, didFinish: Bool)) {
        postLifecycleEvent("seeked", position: Double(data.seconds))
        sendEvent(withName: "player-seeked", body: ["position": Double(data.seconds), "finished": data.didFinish])
    }

    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {`,
      },
      {
        from: `            "playback-queue-ended",
            "playback-state",`,
        to: `            "playback-queue-ended",
            "playback-state",
            "player-seeked",`,
      },
      {
        // iOS「中断结束」通知不带 AVAudioSessionInterruptionOptionKey 时，旧实现直接 return ——
        // 「中断结束」这件事根本不会通知 JS，于是永远没有恢复播放的时机（车机蓝牙下高德
        // 播报结束、音乐不恢复的成因之一，2026-10-03 用户反馈）。缺省按「无 shouldResume」
        // （值 0）处理，事件照发，是否恢复由 JS 侧 plugins/player/service.ts 判断。
        from: `        else if type == .ended {
            guard let optionsValue =
                    userInfo[AVAudioSessionInterruptionOptionKey] as? UInt else {
                return
            }
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)`,
        to: `        else if type == .ended {
            // 缺省 0 = 无 shouldResume：事件照发，是否恢复交给 JS 判断（见 dependencies-patch.js）
            let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)`,
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
  {
    // —— 单一媒体会话所有者（2026-10-06 重构）——
    // Now Playing 信息的写入者只能有一个：AppDelegate.mm 的原生模块
    // （LXSetNowPlayingInfo / LXApplyNowPlayingInfo / LXClearNowPlayingInfo）。
    // RNTP/SwiftAudioEx 在过去也会写/清同一份信息：
    //   · destroy() / clearNowPlayingMetadata() → nowPlayingInfoController.clear()
    //     —— 置空等于让系统拆掉整个媒体会话：屏幕上的卡片停在最后一张快照，
    //     之后任何重发都改不动它，只有重建会话（重启 App / 切前台）才恢复；
    //   · Metadata.update() 写的 info **不带 playbackRate** —— 系统据此把卡片判成
    //     暂停、封面也不再刷新，还会覆盖我们刚发布的内容。
    // 这里把这三处全部改成 no-op / 去掉 clear；会话结束由原生按会话语义清理。
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/Utils/Metadata.swift',
    changes: [
      {
        from: `    static func update(for player: AudioPlayer, with metadata: [String: Any]) {
        currentImageTask?.cancel()
        var ret: [NowPlayingInfoKeyValue] = []
        
        if let title = metadata["title"] as? String {
            ret.append(MediaItemProperty.title(title))
        }
        
        if let artist = metadata["artist"] as? String {
            ret.append(MediaItemProperty.artist(artist))
        }
        
        if let album = metadata["album"] as? String {
            ret.append(MediaItemProperty.albumTitle(album))
        }
        
        if let duration = metadata["duration"] as? Double {
            ret.append(MediaItemProperty.duration(duration))
        }
        
        if let elapsedTime = metadata["elapsedTime"] as? Double {
            ret.append(NowPlayingInfoProperty.elapsedPlaybackTime(elapsedTime))
        }

        if let isLiveStream = metadata["isLiveStream"] as? Bool {
            ret.append(NowPlayingInfoProperty.isLiveStream(isLiveStream))
        }
        
        player.nowPlayingInfoController.set(keyValues: ret)
        
        if let artworkURL = MediaURL(object: metadata["artwork"]) {
            currentImageTask = URLSession.shared.dataTask(with: artworkURL.value, completionHandler: { [weak player] (data, _, error) in
                if let data = data, let image = UIImage(data: data), error == nil {
                    let artwork = MPMediaItemArtwork(boundsSize: image.size, requestHandler: { (size) -> UIImage in
                        return image
                    })
                    player?.nowPlayingInfoController.set(keyValue: MediaItemProperty.artwork(artwork))
                }
            })
            
            currentImageTask?.resume()
        }
    }
`,
        to: `    static func update(for player: AudioPlayer, with metadata: [String: Any]) {
        // LX: 单一媒体会话所有者（2026-10-06 重构，见 dependencies-patch.js）。
        // Now Playing 信息只由 AppDelegate.mm 的原生模块写入（LXSetNowPlayingInfo /
        // LXApplyNowPlayingInfo）：RNTP 这条路会写一份**不带 playbackRate** 的 info，
        // 系统据此把卡片判成暂停 / 丢封面，并与本 App 的发布互相覆盖。
        _ = player
        _ = metadata
    }
`,
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `        soundEffectTapProcessor = nil
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
`,
        to: `        soundEffectTapProcessor = nil
        // LX: 不在此处 clear 系统媒体信息（单一所有者见 AppDelegate.mm）。
        // clear() = 置空 = 系统拆会话：屏幕上的卡片会停在最后一张快照且无法被重发改动；
        // 会话结束由原生 LXClearNowPlayingInfo 按会话语义清理。
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
`,
      },
      {
        from: `    public func clearNowPlayingMetadata(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        player.nowPlayingInfoController.clear()
    }
`,
        to: `    public func clearNowPlayingMetadata(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        // LX: no-op（单一媒体会话所有者，2026-10-06 重构）。
        // 置空会让系统拆掉整个媒体会话（卡片停在最后一张快照，之后重发无效）。
    }
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

  for (const { from, to, optional } of changes) {
    if (normalizedFile.includes(to)) continue
    // 其它补丁可能在同一插入点添加了内容，使整段 to 不再逐字匹配：
    // 若 to 相对 from 新增的全部代码行（长度 >= 24）都已存在，视为已应用。
    // 但必须同时确认前置锚点 from 已不存在：同一次运行里另一个补丁在「别处」插入
    // 了相同的几行（destroy 与 reset 都要写同样的 soundEffect 清理；handler 里也有
    // 同名函数），否则这里会把必做的插入误判为「已应用」而静默跳过（CI 构建即因此缺件）。
    const fromStillPresent = normalizedFile.includes(from)
    const addedLines = String(to).split('\n').map((line) => line.trim())
      .filter((line) => line.length >= 24 && !String(from).includes(line))
    if (!fromStillPresent && addedLines.length > 0 && addedLines.every((line) => normalizedFile.includes(line))) continue
    if (!fromStillPresent) {
      // optional = 针对「旧补丁遗留的本机 node_modules」的迁移步骤：缺失属正常，跳过但留日志；
      // 必需补丁仍然硬失败，暴露依赖升级导致的锚点漂移。
      if (optional) {
        console.log(`Skip optional patch segment (legacy state not present): ${filePath}`)
        continue
      }
      const anchorHint = String(from).trim().split('\n')[0].slice(0, 80)
      throw new Error(`Patch anchor not found: ${filePath} (anchor: "${anchorHint}") —— 依赖升级后补丁片段缺失，请更新 dependencies-patch.js`)
    }
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
  // 每个补丁步骤都必须记录失败：依赖升级导致锚点漂移时，安装/CI 必须失败，
  // 而不是打一行 console.error 后继续（否则构建成功但原生能力悄悄缺失）。
  const failures = []
  const runStep = async(name, run) => {
    try {
      await run()
    } catch (err) {
      const message = err?.message ?? String(err)
      failures.push(`${name}: ${message}`)
      console.error(`Patch step failed: ${name}: ${message}`)
    }
  }

  for (const target of patchTargets) {
    await runStep(target.filePath, () => patchFile(target))
  }
  await runStep('SwiftAudio seek patch', patchSwiftAudioSeek)
  await runStep('TrackPlayer sound effect refresh', patchTrackPlayerSoundEffectRefresh)
  await runStep('Ensure LXEqualizerAudioMix.swift', () => ensureFileContent({
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/LXEqualizerAudioMix.swift',
    content: equalizerAudioMixSwiftSource,
  }))
  await runStep('Ensure shared IR bridge', async() => {
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
  })

  if (failures.length) {
    console.error('\nDependencies patch FAILED（补丁未全部生效，构建会缺少对应原生能力）：')
    for (const item of failures) console.error(`  - ${item}`)
    console.error('\n请确认依赖版本是否变化，并更新 dependencies-patch.js 中的补丁锚点。\n')
    process.exitCode = 1
    return
  }
  console.log('\nDependencies patch finished.\n')
})()
