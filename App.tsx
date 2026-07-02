import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MeshSdk } from 'react-native-mesh-sdk';
import type { MeshMessage, MeshPeer } from 'react-native-mesh-sdk';
import { useMesh } from './src/useMesh';
import { MessageBubble } from './src/components/MessageBubble';
import { MessageInput } from './src/components/MessageInput';
import { PeerList } from './src/components/PeerList';
import { theme } from './src/theme';

/** First-run nickname gate, mirroring bitchat onboarding. */
function Onboarding({ onDone }: { onDone: (nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <SafeAreaView style={styles.onboard}>
      <Text style={styles.logo}>bitchat//mesh</Text>
      <Text style={styles.tagline}>offline · bluetooth · end-to-end encrypted</Text>
      <TextInput
        style={styles.nickInput}
        placeholder="choose a nickname"
        placeholderTextColor={theme.textMuted}
        value={nick}
        onChangeText={setNick}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
      />
      <TouchableOpacity
        style={[styles.enterBtn, !nick.trim() && { opacity: 0.4 }]}
        disabled={!nick.trim()}
        onPress={() => onDone(nick.trim())}
      >
        <Text style={styles.enterText}>join the mesh →</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function Chat({ nickname }: { nickname: string }) {
  const { state, sendPublic, sendPrivate, warmUpSession, clearHistory, setNotificationsEnabled, setPublicNotificationsEnabled } = useMesh(nickname);
  const [activePeer, setActivePeer] = useState<MeshPeer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const messages: MeshMessage[] = useMemo(() => {
    if (activePeer) return state.privateMessages[activePeer.peerID] ?? [];
    return state.publicMessages;
  }, [activePeer, state.privateMessages, state.publicMessages]);

  // Tell the SDK which chat is open so it won't notify for the one on screen.
  useEffect(() => {
    MeshSdk.setActiveChatPeer(activePeer?.peerID ?? null).catch(() => {});
  }, [activePeer]);

  const title = activePeer ? `@${activePeer.nickname}` : '#public mesh';
  const btState = state.bluetoothState;

  const listRef = useRef<FlatList<MeshMessage>>(null);

  // Track keyboard visibility so iOS can show a "hide keyboard" affordance.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setDrawerOpen((v) => !v)}>
          <Text style={styles.menu}>☰</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowDebug((v) => !v)}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {state.ready ? `${state.peers.length} peers · ${btState} · debug▾` : 'starting mesh… · debug▾'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.me}>{state.nickname}</Text>
      </View>

      {/* Prompt the user to turn Bluetooth on — the mesh can't run without it. */}
      {(btState === 'poweredOff' || btState === 'unauthorized') && (
        <TouchableOpacity
          style={styles.btBanner}
          onPress={() => {
            MeshSdk.enableBluetooth().then((enabled) => {
              if (!enabled) {
                Alert.alert(
                  'Bluetooth is off',
                  Platform.OS === 'ios'
                    ? 'Turn Bluetooth on in Control Center or Settings to use the mesh.'
                    : 'Turn Bluetooth on to use the mesh.'
                );
              }
            });
          }}
        >
          <Text style={styles.btBannerText}>
            {btState === 'unauthorized'
              ? '⚠ Bluetooth permission needed — tap to open settings'
              : '⚠ Bluetooth is off — tap to turn it on'}
          </Text>
        </TouchableOpacity>
      )}

      {showDebug && (
        <ScrollView style={styles.debugBox} contentContainerStyle={{ padding: 10 }}>
          <Text selectable style={styles.debugText}>
            myPeerID: {state.myPeerID || '—'}{'\n'}
            ready: {String(state.ready)}{'\n'}
            {state.debug}
          </Text>
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() =>
              Alert.alert('Clear history?', 'This deletes all stored messages on this device.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: () => clearHistory() },
              ])
            }
          >
            <Text style={styles.clearBtnText}>clear history</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <View style={styles.body}>
        {drawerOpen && (
          <View style={styles.drawer}>
            <PeerList
              peers={state.peers}
              activePeerID={activePeer?.peerID ?? null}
              onSelectPublic={() => { setActivePeer(null); setDrawerOpen(false); }}
              onSelectPeer={(p) => {
                setActivePeer(p);
                setDrawerOpen(false);
                // Warm up the handshake on open (latency only; delivery is guaranteed by the SDK).
                warmUpSession(p.peerID);
              }}
            />
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>private notifications</Text>
              <Switch
                style={styles.switch}
                value={state.notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>public notifications</Text>
              <Switch
                style={styles.switch}
                value={state.publicNotificationsEnabled}
                onValueChange={setPublicNotificationsEnabled}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
          </View>
        )}

        <View style={styles.chat}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            keyboardDismissMode="interactive"
            renderItem={({ item }) => (
              <MessageBubble message={item} mine={item.senderPeerID === state.myPeerID || item.sender === state.nickname} />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {activePeer ? 'no messages yet — say hi privately' : 'broadcast a message to nearby peers'}
              </Text>
            }
            contentContainerStyle={messages.length === 0 && styles.emptyWrap}
            // Keep the newest message in view when one arrives (or on chat switch).
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
          {/* iOS keyboard has no dismiss key — offer one while it's open. */}
          {Platform.OS === 'ios' && keyboardUp && (
            <TouchableOpacity style={styles.kbDismiss} onPress={() => Keyboard.dismiss()}>
              <Text style={styles.kbDismissText}>⌄ hide keyboard</Text>
            </TouchableOpacity>
          )}
          <MessageInput
            placeholder={activePeer ? `message @${activePeer.nickname}` : 'message the mesh'}
            onSend={(text) =>
              activePeer ? sendPrivate(activePeer.peerID, activePeer.nickname, text) : sendPublic(text)
            }
          />
        </View>
      </View>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

export default function App() {
  const [nickname, setNickname] = useState<string | null>(null);
  if (!nickname) return <Onboarding onDone={setNickname} />;
  return <Chat nickname={nickname} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1, flexDirection: 'row' },
  chat: { flex: 1 },
  kbDismiss: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 14, marginBottom: 2 },
  kbDismissText: { color: theme.textMuted, fontFamily: theme.mono, fontSize: 12 },
  drawer: { width: '62%', borderRightWidth: 1, borderRightColor: theme.border },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border },
  settingLabel: { flex: 1, color: theme.text, fontFamily: theme.mono, fontSize: 12, marginRight: 8 },
  // iOS switches are chunkier than Android's — scale them down so the row fits the drawer.
  switch: Platform.OS === 'ios' ? { transform: [{ scale: 0.75 }] } : {},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    // Push the header content lower (below the status bar / notch).
    paddingTop: 28,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.surface,
  },
  menu: { color: theme.accent, fontSize: 20 },
  title: { color: theme.text, fontFamily: theme.mono, fontSize: 16, fontWeight: '600' },
  subtitle: { color: theme.textMuted, fontFamily: theme.mono, fontSize: 11 },
  me: { color: theme.textDim, fontFamily: theme.mono, fontSize: 12 },

  btBanner: { backgroundColor: '#5a1e1e', paddingVertical: 8, paddingHorizontal: 12 },
  btBannerText: { color: '#ffd7d7', fontFamily: theme.mono, fontSize: 12, textAlign: 'center' },

  debugBox: { maxHeight: 220, backgroundColor: '#050505', borderBottomWidth: 1, borderBottomColor: theme.border },
  debugText: { color: theme.textDim, fontFamily: theme.mono, fontSize: 10 },
  clearBtn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#7a2e2e', borderRadius: 4 },
  clearBtnText: { color: '#ff8a8a', fontFamily: theme.mono, fontSize: 11 },

  empty: { color: theme.textMuted, fontFamily: theme.mono, textAlign: 'center', fontSize: 13 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },

  onboard: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { color: theme.accent, fontFamily: theme.mono, fontSize: 28, fontWeight: '700' },
  tagline: { color: theme.textDim, fontFamily: theme.mono, fontSize: 12, marginTop: 8, marginBottom: 40 },
  nickInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  enterBtn: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  enterText: { color: theme.accent, fontFamily: theme.mono, fontSize: 15 },
});
