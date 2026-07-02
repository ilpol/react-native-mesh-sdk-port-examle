import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MeshSdk,
  type MeshMessage,
  type MeshPeer,
  type BluetoothState,
} from 'react-native-mesh-sdk';

// ---- Persistent history --------------------------------------------------
// Core BitChat is ephemeral by design (it never stores messages), so the app
// owns history. We persist the message log to AsyncStorage and rehydrate it on
// launch, capped so it can't grow without bound.
const STORE_PUBLIC = 'mesh:publicMessages';
const STORE_PRIVATE = 'mesh:privateMessages';
const STORE_NOTIF = 'mesh:notificationsEnabled';
const MAX_PUBLIC = 500; // keep the newest N public messages
const MAX_PER_PRIVATE = 300; // keep the newest N per conversation

async function loadHistory(): Promise<{
  publicMessages: MeshMessage[];
  privateMessages: Record<string, MeshMessage[]>;
}> {
  try {
    const [pub, priv] = await AsyncStorage.multiGet([STORE_PUBLIC, STORE_PRIVATE]);
    return {
      publicMessages: pub[1] ? (JSON.parse(pub[1]) as MeshMessage[]) : [],
      privateMessages: priv[1]
        ? (JSON.parse(priv[1]) as Record<string, MeshMessage[]>)
        : {},
    };
  } catch {
    return { publicMessages: [], privateMessages: {} };
  }
}

// This example runs on its OWN mesh network — a custom BLE service/characteristic
// UUID pair, distinct from the SDK default. Every device running this app shares
// it, and it stays isolated from any other react-native-mesh-sdk app. Demonstrates
// MeshSdk.setMeshId(). ("4D455348" = "MESH" in ASCII.)
const MESH_SERVICE_UUID = '4D455348-0000-4000-8000-00000000C0DE';
const MESH_CHARACTERISTIC_UUID = '4D455348-0000-4000-8000-00000000DA7A';

// In-code toggle for local notifications on incoming private messages. Flip to
// `false` to disable them entirely. (They also require the POST_NOTIFICATIONS
// runtime permission on Android 13+.)
const NOTIFICATIONS_ENABLED = true;

/**
 * Requests the runtime Bluetooth/location permissions Core BitChat needs.
 * No-op on iOS (handled via Info.plist usage strings + system prompt).
 */
async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const api =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
  const P = PermissionsAndroid.PERMISSIONS;

  // Core BitChat's BluetoothPermissionManager requires ACCESS_FINE +
  // COARSE_LOCATION on ALL API levels (plus the BLE runtime perms on 31+).
  // If location isn't granted the core reports "Has Permissions: false" and the
  // mesh never starts — so we must request location even on Android 12+.
  const required: string[] = [
    P.ACCESS_FINE_LOCATION,
    P.ACCESS_COARSE_LOCATION,
  ];
  if (api >= 31) {
    required.push(P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT);
  }

  // POST_NOTIFICATIONS (API 33+) is optional — only needed for the background
  // foreground-service notification, not for foreground mesh.
  const optional: string[] =
    api >= 33 && P.POST_NOTIFICATIONS ? [P.POST_NOTIFICATIONS] : [];

  try {
    const res = await PermissionsAndroid.requestMultiple([
      ...required.filter(Boolean),
      ...optional,
    ] as any);
    return required.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

export interface MeshState {
  ready: boolean;
  myPeerID: string;
  nickname: string;
  peers: MeshPeer[];
  /** Public broadcast messages, oldest → newest. */
  publicMessages: MeshMessage[];
  /** Private messages keyed by the other peer's id. */
  privateMessages: Record<string, MeshMessage[]>;
  bluetoothState: BluetoothState;
  /** Whether local DM notifications are enabled (user-toggleable). */
  notificationsEnabled: boolean;
  /** Live diagnostics for troubleshooting the mesh. */
  debug: string;
}

/**
 * The single React hook the example uses to drive the mesh. It mirrors the
 * responsibilities of bitchat's `ChatViewModel`: own the message/peer state,
 * subscribe to transport events, and expose send actions.
 */
export function useMesh(initialNickname: string) {
  const [state, setState] = useState<MeshState>({
    ready: false,
    myPeerID: '',
    nickname: initialNickname,
    peers: [],
    publicMessages: [],
    privateMessages: {},
    bluetoothState: 'unknown',
    notificationsEnabled: NOTIFICATIONS_ENABLED,
    debug: 'init…',
  });

  const nicknameRef = useRef(initialNickname);
  // Don't persist until we've rehydrated, or the initial empty state would
  // clobber the stored history before it loads.
  const hydratedRef = useRef(false);

  const upsertPrivate = useCallback((peerID: string, msg: MeshMessage) => {
    setState((s) => {
      const list = s.privateMessages[peerID] ?? [];
      if (list.some((m) => m.id === msg.id)) return s;
      return { ...s, privateMessages: { ...s.privateMessages, [peerID]: [...list, msg] } };
    });
  }, []);

  // ---- Bootstrap ---------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    const subs = [
      MeshSdk.onMessage((message) => {
        if (message.isPrivate && message.senderPeerID) {
          upsertPrivate(message.senderPeerID, message);
        } else {
          setState((s) =>
            s.publicMessages.some((m) => m.id === message.id)
              ? s
              : { ...s, publicMessages: [...s.publicMessages, message] }
          );
        }
      }),
      MeshSdk.onPeerSnapshotsUpdate((peers) => {
        if (mounted) setState((s) => ({ ...s, peers }));
      }),
      MeshSdk.addListener('onDeliveryStatusUpdate', ({ messageID, status }) => {
        setState((s) => ({
          ...s,
          publicMessages: s.publicMessages.map((m) =>
            m.id === messageID ? { ...m, deliveryStatus: status } : m
          ),
          privateMessages: Object.fromEntries(
            Object.entries(s.privateMessages).map(([k, list]) => [
              k,
              list.map((m) => (m.id === messageID ? { ...m, deliveryStatus: status } : m)),
            ])
          ),
        }));
      }),
      MeshSdk.addListener('onBluetoothStateChange', ({ state: bt }) => {
        setState((s) => ({ ...s, bluetoothState: bt }));
      }),
    ];

    (async () => {
      try {
        // Rehydrate persisted history first, merging with anything that may have
        // arrived while we were loading (history first, live messages appended).
        const hist = await loadHistory();
        if (mounted) {
          setState((s) => {
            const seenPub = new Set(s.publicMessages.map((m) => m.id));
            const publicMessages = [
              ...hist.publicMessages.filter((m) => !seenPub.has(m.id)),
              ...s.publicMessages,
            ];
            const privateMessages: Record<string, MeshMessage[]> = { ...hist.privateMessages };
            for (const [k, list] of Object.entries(s.privateMessages)) {
              const base = privateMessages[k] ?? [];
              const seen = new Set(base.map((m) => m.id));
              privateMessages[k] = [...base, ...list.filter((m) => !seen.has(m.id))];
            }
            return { ...s, publicMessages, privateMessages };
          });
        }
        hydratedRef.current = true;

        const ok = await ensurePermissions();
        if (!ok) {
          if (mounted) setState((s) => ({ ...s, debug: 'PERMISSIONS DENIED' }));
          return;
        }
        // Pick our own mesh network BEFORE anything starts the BLE stack.
        await MeshSdk.setMeshId(MESH_SERVICE_UUID, MESH_CHARACTERISTIC_UUID);
        await MeshSdk.setNickname(nicknameRef.current);
        // Restore the saved notifications preference (defaults to the in-code flag).
        const savedNotif = await AsyncStorage.getItem(STORE_NOTIF);
        const notifEnabled = savedNotif == null ? NOTIFICATIONS_ENABLED : savedNotif === '1';
        await MeshSdk.setNotificationsEnabled(notifEnabled);
        if (mounted) setState((s) => ({ ...s, notificationsEnabled: notifEnabled }));
        await MeshSdk.startServices();
        const myPeerID = await MeshSdk.getMyPeerID();
        const peers = await MeshSdk.getPeers();
        if (mounted) setState((s) => ({ ...s, ready: true, myPeerID, peers, debug: 'services started' }));
      } catch (e) {
        if (mounted) setState((s) => ({ ...s, debug: `START ERROR: ${String(e)}` }));
      }
    })();

    // Poll the Core's own debug status so we can see BLE/peer state without logcat.
    const poll = setInterval(async () => {
      try {
        const [status, peers] = await Promise.all([
          MeshSdk.getDebugStatus(),
          MeshSdk.getPeers(),
        ]);
        if (mounted) setState((s) => ({ ...s, debug: status, peers }));
      } catch (e) {
        if (mounted) setState((s) => ({ ...s, debug: `poll error: ${String(e)}` }));
      }
    }, 3000);

    return () => {
      mounted = false;
      clearInterval(poll);
      subs.forEach((sub) => sub.remove());
      MeshSdk.stopServices();
    };
  }, [upsertPrivate]);

  // ---- Persist history on every change (after rehydration) ---------------
  useEffect(() => {
    if (!hydratedRef.current) return;
    const capped = state.publicMessages.slice(-MAX_PUBLIC);
    const cappedPrivate: Record<string, MeshMessage[]> = {};
    for (const [k, list] of Object.entries(state.privateMessages)) {
      cappedPrivate[k] = list.slice(-MAX_PER_PRIVATE);
    }
    AsyncStorage.multiSet([
      [STORE_PUBLIC, JSON.stringify(capped)],
      [STORE_PRIVATE, JSON.stringify(cappedPrivate)],
    ]).catch(() => {});
  }, [state.publicMessages, state.privateMessages]);

  // ---- Actions -----------------------------------------------------------

  /** Toggle local notifications; persists the choice and updates the SDK. */
  const setNotificationsEnabled = useCallback(async (enabled: boolean) => {
    setState((s) => ({ ...s, notificationsEnabled: enabled }));
    await AsyncStorage.setItem(STORE_NOTIF, enabled ? '1' : '0').catch(() => {});
    await MeshSdk.setNotificationsEnabled(enabled).catch(() => {});
  }, []);

  /** Wipe the persisted + in-memory history (e.g. a "clear chat" action). */
  const clearHistory = useCallback(async () => {
    hydratedRef.current = true;
    await AsyncStorage.multiRemove([STORE_PUBLIC, STORE_PRIVATE]).catch(() => {});
    setState((s) => ({ ...s, publicMessages: [], privateMessages: {} }));
  }, []);

  const sendPublic = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      await MeshSdk.sendMessage(content.trim());
      // Optimistically render our own outgoing message.
      setState((s) => ({
        ...s,
        publicMessages: [
          ...s.publicMessages,
          {
            id: `local-${Date.now()}`,
            sender: s.nickname,
            content: content.trim(),
            type: 'message' as any,
            timestamp: Date.now(),
            isRelay: false,
            isPrivate: false,
            isEncrypted: false,
            senderPeerID: s.myPeerID,
            deliveryStatus: { kind: 'sent' },
          },
        ],
      }));
    },
    []
  );

  /**
   * Optional warm-up: start the Noise handshake early (e.g. when a chat opens)
   * so the first message sends instantly. Delivery itself is guaranteed by the
   * SDK — MeshSdk.sendPrivateMessage establishes the session before sending — so
   * this is purely a latency optimization, fire-and-forget.
   */
  const warmUpSession = useCallback((peerID: string) => {
    MeshSdk.initiateNoiseHandshake(peerID).catch(() => {});
  }, []);

  const sendPrivate = useCallback(
    async (peerID: string, nickname: string, content: string) => {
      if (!content.trim()) return;
      // The SDK ensures the Noise session before sending, so the first private
      // message is no longer dropped — just send.
      const id = await MeshSdk.sendPrivateMessage(content.trim(), peerID, nickname);
      upsertPrivate(peerID, {
        id,
        sender: nicknameRef.current,
        content: content.trim(),
        type: 'message' as any,
        timestamp: Date.now(),
        isRelay: false,
        isPrivate: true,
        recipientNickname: nickname,
        senderPeerID: peerID, // bucketed by conversation peer
        isEncrypted: true,
        deliveryStatus: { kind: 'sending' },
      });
    },
    [upsertPrivate]
  );

  const setNickname = useCallback(async (nickname: string) => {
    nicknameRef.current = nickname;
    await MeshSdk.setNickname(nickname);
    setState((s) => ({ ...s, nickname }));
  }, []);

  const markRead = useCallback(async (messageID: string, peerID: string) => {
    await MeshSdk.sendReadReceipt(messageID, peerID, nicknameRef.current);
  }, []);

  return { state, sendPublic, sendPrivate, setNickname, markRead, warmUpSession, clearHistory, setNotificationsEnabled };
}
