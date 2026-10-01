//
//  ZeroCopyBridge.swift
//  LiquidGlass
//
//  Created by Alexey Demin on 2025-12-22.
//

import CoreVideo

class ZeroCopyBridge {
    let device: MTLDevice
    var textureCache: CVMetalTextureCache?
    var pixelBuffer: CVPixelBuffer?
    var cvTexture: CVMetalTexture?

    /// 已退役的零拷贝缓冲（保留一代以上再释放）。
    ///
    /// 为什么不能立刻释放：`LiquidGlassView.layoutSubviews`（主线程）会用新尺寸重建缓冲，
    /// 而该玻璃实例的渲染线程可能**正在**采样上一代的 IOSurface —— 两者之间没有任何同步
    /// （draw → captureBackground 在渲染线程，layoutSubviews 在主线程，且 layoutSubviews
    /// 触发极频繁：Tab 栏收起/展开、胶囊变宽、旋转等任何几何变化都会进来）。
    /// 一旦把还在被 GPU/CPU 使用的 IOSurface 释放掉，真机表现就是随机 SIGSEGV /
    /// EXC_BAD_ACCESS 闪退 —— 用户反馈的「突然弹出 Unexpected error occured / Signal 11
    /// was raised，然后闪退」正是这一类。
    /// 这里保留最近两代，等换到第三代时才释放最早的一代（间隔已跨过多帧渲染）。
    private var retired: [(buffer: CVPixelBuffer, texture: CVMetalTexture?)] = []
    private let maxRetired = 2

    init(device: MTLDevice) {
        self.device = device
        let status = CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &textureCache)
        if status != kCVReturnSuccess {
            print("Failed to create texture cache: \(status)")
        }
    }

    func setupBuffer(width: Int, height: Int) {
        // 退化尺寸（布局未完成 / 视图被隐藏时 bounds 为 0）不重建：
        // CVPixelBufferCreate 会失败，而且会白白把渲染线程正在采样的缓冲换掉。
        guard width > 0, height > 0 else { return }
        // 尺寸没变就复用现有缓冲：layoutSubviews 触发极频繁，等尺寸重建纯属浪费，
        // 每次重建又都是一次「换掉渲染线程正在采样的纹理」的竞态窗口。
        if let current = pixelBuffer,
           CVPixelBufferGetWidth(current) == width,
           CVPixelBufferGetHeight(current) == height {
            return
        }

        let attrs = [
            kCVPixelBufferMetalCompatibilityKey: true,
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferIOSurfacePropertiesKey: [:] // Enables zero-copy via IOSurface
        ] as CFDictionary

        var newBuffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attrs, &newBuffer)
        if status != kCVReturnSuccess {
            print("Failed to create pixel buffer: \(status)")
            return
        }

        guard let buffer = newBuffer, let cache = textureCache else { return }

        // Create the Metal Texture wrapper for the CVPixelBuffer
        var newTexture: CVMetalTexture?
        CVMetalTextureCacheCreateTextureFromImage(kCFAllocatorDefault, cache, buffer, nil, .bgra8Unorm, width, height, 0, &newTexture)
        guard newTexture != nil else { return }

        // 旧的降为「已退役」而非立刻释放（见 retired 注释）。旧缓冲在此之前一直被强引用着，
        // 所以在这一行之前，渲染线程无论何时取纹理都是安全的。
        if let oldBuffer = pixelBuffer {
            retired.append((buffer: oldBuffer, texture: cvTexture))
            while retired.count > maxRetired { retired.removeFirst() }
        }
        pixelBuffer = buffer
        cvTexture = newTexture
    }

    func render(actions: (CGContext) -> Void) -> MTLTexture? {
        guard let buffer = pixelBuffer else { return nil }

        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)

        // Lock for CPU writing
        CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags(rawValue: 0))
        defer {
            // 只解锁，**不再 flush 纹理缓存**。
            // CVMetalTextureCacheFlush 会让缓存里的纹理失效，而它在这里是主线程、每秒约
            // 30 次（全局 33ms 节流）调用；此时该玻璃实例的渲染线程极可能正在采样同一个
            // 纹理（draw → shader 采样）——让正在被采样的纹理失效/被释放，正是真机上随机
            // SIGSEGV（Unexpected error occured / Signal 11 was raised）的经典来源。
            // 我们自己在 cvTexture 里强引用着纹理，CPU 写入的可见性由
            // CVPixelBufferUnlockBaseAddress 保证，无需 flush；纹理只在尺寸变化时重建
            // （见 setupBuffer 的复用判断），缓存也不会无限增长。
            CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags(rawValue: 0))
        }
        
        let data = CVPixelBufferGetBaseAddress(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)

        // Create CGContext from shared memory
        guard let context = CGContext(
            data: data,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return nil
        }

        actions(context)

        // Get MTLTexture from the retained CVMetalTexture
        return cvTexture.flatMap { CVMetalTextureGetTexture($0) }
    }
}
