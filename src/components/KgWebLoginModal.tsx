import { forwardRef, useImperativeHandle, useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Modal as RNModal } from 'react-native';
import WebView from 'react-native-webview';
import Modal, { type ModalType } from '@/components/common/Modal';
import { useTheme } from '@/store/theme/hook';
import { useStatusbarHeight } from '@/store/common/hook';
import { Icon } from '@/components/common/Icon';
import Text from '@/components/common/Text';
import { toast } from '@/utils/tools';
import { sendCaptcha, loginByPhone, buildCookieString, getVerifyInfo, verifyUserInfo } from '@/utils/musicSdk/kg/utils/api';

export interface KgWebLoginModalType { show: () => void }

function generateVerifyHtml(txappid: string, ssaCode: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>*{margin:0;padding:0}body{background:transparent}</style></head><body><script>
var appid='${txappid}';var code='${ssaCode}';
var s=document.createElement('script');s.src='https://turing.captcha.qcloud.com/TCaptcha.js';
s.onload=function(){var c=new TencentCaptcha(appid,function(r){
if(r.ret===0){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ok',ticket:r.ticket,randstr:r.randstr,appid:appid,code:code}));}
else{window.ReactNativeWebView.postMessage(JSON.stringify({type:'captcha_fail',ret:r.ret,desc:r.desc}));}
},{type:'popup',enableDarkMode:false,themeColor:'#1677ff'});c.show();};
s.onerror=function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',msg:String(e)}));};
document.head.appendChild(s);</script></body></html>`;
}

const KgWebLoginModal = forwardRef<KgWebLoginModalType, object>((_, ref) => {
  const modalRef = useRef<ModalType>(null)
  const theme = useTheme()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const [logging, setLogging] = useState(false)
  const [showVerify, setShowVerify] = useState(false)
  const [verifyHtml, setVerifyHtml] = useState('')
  const [showMultiAccount, setShowMultiAccount] = useState(false)
  const [pendingData, setPendingData] = useState<{ mobile: string; code: string } | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendRef = useRef<() => void>(() => {})

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); if (cdRef.current) clearInterval(cdRef.current) }, [])

  const handleClose = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (cdRef.current) { clearInterval(cdRef.current); cdRef.current = null }
    setShowVerify(false); setShowMultiAccount(false); setPendingData(null); setSelectedId('')
    modalRef.current?.setVisible(false)
  }, [])

  useImperativeHandle(ref, () => ({
    show() { setPhone(''); setCode(''); setSending(false); setCountdown(0); setCooldown(0); setLogging(false); setShowVerify(false); setShowMultiAccount(false); setPendingData(null); setSelectedId(''); modalRef.current?.setVisible(true) },
  }))

  const handleVerifyMsg = useCallback(async (e: any) => {
    try {
      const d = JSON.parse(e.nativeEvent.data)
      console.log('[KgLogin] 滑块验证回调:', JSON.stringify(d))
      console.log('[KgLogin] 滑块回调原始数据:', JSON.stringify(d))
      if (d.type === 'ok') {
        const vcode = 'KGCodeTX|' + JSON.stringify({ ticket: d.ticket, randstr: d.randstr, txappid: d.appid })
        console.log('[KgLogin] 提交验证结果...')
        const r = await verifyUserInfo(d.code, 23, vcode, '', '')
        console.log('[KgLogin] verifyUserInfo result:', JSON.stringify(r))
        setShowVerify(false)
        if (r.success) { toast('验证通过'); setTimeout(() => sendRef.current?.(), 500) } else toast('验证失败')
      } else if (d.type === 'error') {
        console.log('[KgLogin] 脚本加载失败:', d.msg)
        toast('验证脚本加载失败，请检查网络')
        setShowVerify(false)
      } else if (d.type === 'captcha_fail') {
        console.log('[KgLogin] 验证失败, ret=', d.ret, 'desc=', d.desc)
        toast('验证失败: ' + (d.desc || '请重试'))
        setShowVerify(false)
      } else {
        console.log('[KgLogin] 未知回调类型:', d.type)
        setShowVerify(false)
      }
    } catch (err) { console.error('[KgLogin] handleVerifyMsg error:', err); setShowVerify(false) }
  }, [])

  const handleSendCode = useCallback(async () => {
    if (!phone || phone.length < 11) { toast('请输入正确的手机号'); return }
    if (cooldown > 0) { toast('请稍后再试'); return }
    setSending(true)
    try {
      const result = await sendCaptcha(phone, () => {})
      console.log('[KgLogin] sendCaptcha result:', JSON.stringify(result))
      if (result.success) {
        console.log('[KgLogin] 验证码发送成功')
        toast('验证码已发送'); let s = 60; setCountdown(s)
        timerRef.current = setInterval(() => { s--; setCountdown(s); if (s <= 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }, 1000)
      } else if (result.ssaCode) {
        console.log('[KgLogin] 需要滑块验证, ssaCode:', result.ssaCode)
        const vr = await getVerifyInfo(result.ssaCode)
        if (vr.success && vr.data?.txappid) { setVerifyHtml(generateVerifyHtml(vr.data.txappid, result.ssaCode)); setShowVerify(true) }
        else { console.log('[KgLogin] getVerifyInfo failed:', vr.message); toast('获取验证信息失败') }
      } else { console.log('[KgLogin] sendCaptcha failed:', result.message); toast(result.message || '发送验证码失败') }
    } catch (err: any) { console.error('[KgLogin] sendCaptcha error:', err); toast('发送验证码失败: ' + (err.message || '')) } finally {
      setSending(false); setCooldown(2)
      cdRef.current = setInterval(() => { setCooldown(p => { if (p <= 1) { if (cdRef.current) { clearInterval(cdRef.current); cdRef.current = null }; return 0 }; return p - 1 }) }, 1000)
    }
  }, [phone, cooldown, sending])
  sendRef.current = handleSendCode

  const handleMultiLogin = useCallback(async (userId: string) => {
    if (!pendingData) return; setShowMultiAccount(false); setLogging(true)
    try {
      const r = await loginByPhone(pendingData.mobile, pendingData.code, () => {}, userId)
      if (r.success && r.data) { global.app_event.emit('kg-cookie-set', buildCookieString(r.data)); toast('登录成功！'); handleClose() }
      else toast(r.message || '登录失败')
    } catch { toast('登录失败') } finally { setLogging(false); setPendingData(null) }
  }, [pendingData, handleClose])

  const handleLogin = useCallback(async () => {
    if (!phone || phone.length < 11) { toast('请输入正确的手机号'); return }
    if (!code || code.length < 4) { toast('请输入验证码'); return }
    setLogging(true)
    try {
      const r = await loginByPhone(phone, code, () => {})
      if (r.success && r.data) { global.app_event.emit('kg-cookie-set', buildCookieString(r.data)); toast('登录成功！'); handleClose() }
      else if (r.message?.includes('34175')) { setPendingData({ mobile: phone, code }); setShowMultiAccount(true) }
      else toast(r.message || '登录失败')
    } catch { toast('登录失败') } finally { setLogging(false) }
  }, [phone, code, handleClose])

  return (
    <Modal ref={modalRef} statusBarPadding={false} bgHide={false} bgColor="rgba(0,0,0,0.5)">
      <View style={styles.container}>
        <View style={[styles.header, { height: 56 + useStatusbarHeight(), paddingTop: useStatusbarHeight(), backgroundColor: theme['c-content-background'] }]}>
          <TouchableOpacity onPress={handleClose} style={styles.backBtn}><Icon name="chevron-left" size={26} color={theme['c-font']} /></TouchableOpacity>
          <Text size={18} weight="600">登录</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Text size={15} style={[styles.smsTitle, { color: theme['c-font'] }]}>使用手机短信验证码登录</Text>
          <View style={[styles.inputRow, { borderBottomColor: theme['c-border'] }]}>
            <Text size={15} color={theme['c-font']}>+86  |  </Text>
            <TextInput style={[styles.input, { color: theme['c-font'] }]} placeholder="手机号" placeholderTextColor={theme['c-font-label']} keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={11} editable={!logging} />
            {phone.length > 0 && <TouchableOpacity onPress={() => setPhone('')}><Icon name="close" size={18} color={theme['c-font-label']} /></TouchableOpacity>}
          </View>
          <View style={[styles.inputRow, { borderBottomColor: theme['c-border'] }]}>
            <TextInput style={[styles.input, { color: theme['c-font'] }]} placeholder="验证码" placeholderTextColor={theme['c-font-label']} keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} editable={!logging} />
            <TouchableOpacity onPress={handleSendCode} disabled={countdown > 0 || sending || cooldown > 0 || logging}>
              <Text size={14} color={countdown > 0 || cooldown > 0 ? theme['c-font-label'] : '#1677ff'}>{countdown > 0 ? `${countdown}s` : sending ? '发送中...' : cooldown > 0 ? '请稍候' : '获取验证码'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.loginBtn, { backgroundColor: logging ? theme['c-border'] : '#1677ff' }]} onPress={handleLogin} disabled={logging}>
            <Text size={16} color="#fff" weight="600">{logging ? '登录中...' : '登录'}</Text>
          </TouchableOpacity>
          <Text size={12} color={theme['c-font-label']} style={styles.smsTip}>手机号仅用于酷狗音乐官方发送验证码与登录接口，不予保存；{'\n'}本地仅存储登录凭证。</Text>
        </ScrollView>

        {showVerify && verifyHtml ? (
          <View style={styles.verifyOverlay}>
            <View style={styles.verifyBox}>
              <WebView source={{ html: verifyHtml }} onMessage={handleVerifyMsg} style={{ flex: 1 }} javaScriptEnabled domStorageEnabled useWebKit cacheEnabled={false} incognito nestedScrollEnabled overScrollMode="never" bounces={false} setSupportMultipleWindows={false} allowsFullscreenVideo mediaPlaybackRequiresUserAction={false} />
            </View>
          </View>
        ) : null}

        <RNModal visible={showMultiAccount} transparent animationType="fade" onRequestClose={() => setShowMultiAccount(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: '#fff' }]}>
              <Text size={16} weight="500" style={{ textAlign: 'center', marginBottom: 16, color: theme['c-font'] }}>该手机号绑定了多个账号</Text>
              <View style={[styles.idInput, { borderBottomColor: theme['c-border'] }]}>
                <TextInput style={[styles.idInputText, { color: theme['c-font'] }]} placeholder="请输入您要登录的酷狗ID" placeholderTextColor={theme['c-font-label']} value={selectedId} onChangeText={setSelectedId} keyboardType="number-pad" autoFocus />
              </View>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#1677ff', marginTop: 20 }]} onPress={() => handleMultiLogin(selectedId)} disabled={!selectedId.trim()} activeOpacity={0.8}>
                <Text size={16} weight="600" color="#fff">确定登录</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme['c-border'], marginTop: 10 }]} onPress={() => { setShowMultiAccount(false); setPendingData(null); setSelectedId('') }} activeOpacity={0.8}>
                <Text size={16} weight="500" color="#fff">取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </RNModal>
      </View>
    </Modal>
  )
})

export default KgWebLoginModal

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  backBtn: { padding: 8, width: 44, alignItems: 'center', justifyContent: 'center' },

  smsTitle: { textAlign: 'center', marginTop: 20, marginBottom: 20, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 14, marginHorizontal: 20 },
  input: { flex: 1, fontSize: 15, padding: 0 },
  loginBtn: { marginTop: 30, marginHorizontal: 20, paddingVertical: 14, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  smsTip: { textAlign: 'center', marginTop: 20, lineHeight: 18, paddingHorizontal: 20 },
  verifyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  verifyBox: { width: '90%', height: 350, borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { width: '80%', borderRadius: 16, padding: 24, backgroundColor: '#fff' },
  idInput: { borderBottomWidth: 1, paddingVertical: 14, marginTop: 8 },
  idInputText: { fontSize: 15, padding: 0 },
  modalBtn: { paddingVertical: 14, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
})