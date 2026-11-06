/**
 * Contexto principal de Mi Libreta.
 *
 * Administra:
 * - Instancia de base de datos local (Dexie / IndexedDB).
 * - Estado de autenticación con Supabase Auth o Modo Local / Demostración.
 * - Estado de conectividad, guardado local y sincronización remota.
 * - Detección de persistencia del navegador (`navigator.storage.persist()`).
 * - Tamaño de letra ampliable (Normal / Grande / Muy grande) para accesibilidad.
 * - Bloqueo opcional de pantalla para dispositivos compartidos (aclarando que no cifra IndexedDB).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LibretaDB } from '../db/db';
import { configureDb, onLocalChange, save } from '../db/repo';
import { seedDemoData } from '../db/seedDemo';
import { SyncEngine } from '../sync/engine';
import { getSupabaseClient, isSupabaseConfigured, SupabaseRemote } from '../sync/supabaseRemote';
import type { Remote } from '../sync/remote';

export type SyncStatus = 'local_only' | 'pending' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

export type FontScale = 'normal' | 'large' | 'xlarge';

interface AppContextValue {
  db: LibretaDB;
  ready: boolean;
  deviceLabel: string;
  setDeviceLabel: (label: string) => void;
  userEmail: string | null;
  userId: string | null;
  isCloudConfigured: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  conflictsCount: number;
  lastSyncAt: string | null;
  syncError: string | null;
  storagePersisted: boolean | null;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  triggerSync: () => Promise<void>;
  signOut: () => Promise<void>;
  undoLastGradeChange: () => Promise<boolean>;
  canUndoGrade: boolean;
  /** Permite inyectar un servidor remoto en pruebas automatizadas (Playwright / Vitest). */
  setCustomRemote: (remote: Remote | null, ownerId?: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function detectDefaultDeviceLabel(): string {
  const saved = localStorage.getItem('milibreta_device_label');
  if (saved) return saved;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const label = /Android|iPhone|iPad|Mobile/i.test(ua) ? 'Celular' : 'Computadora';
  localStorage.setItem('milibreta_device_label', label);
  return label;
}

export const sharedDb = new LibretaDB('mi-libreta-db');

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [deviceLabel, setDeviceLabelState] = useState<string>(detectDefaultDeviceLabel);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [customRemote, setCustomRemoteState] = useState<Remote | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);
  const [fontScale, setFontScaleState] = useState<FontScale>(
    () => (localStorage.getItem('milibreta_font_scale') as FontScale) || 'normal',
  );

  const engineRef = useRef<SyncEngine | null>(null);

  const pendingCount = useLiveQuery(() => sharedDb.outbox.count(), [], 0);
  const conflictsCount = useLiveQuery(() => sharedDb.conflicts.count(), [], 0);
  const lastSyncMeta = useLiveQuery(() => sharedDb.getMeta<string>('last_sync_at'), [], undefined);
  const revisionsCount = useLiveQuery(() => sharedDb.local_revisions.count(), [], 0);

  const setDeviceLabel = useCallback((label: string) => {
    const clean = label.trim() || 'Este dispositivo';
    localStorage.setItem('milibreta_device_label', clean);
    setDeviceLabelState(clean);
  }, []);

  const setFontScale = useCallback((scale: FontScale) => {
    localStorage.setItem('milibreta_font_scale', scale);
    setFontScaleState(scale);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('font-scale-normal', 'font-scale-large', 'font-scale-xlarge');
    root.classList.add(`font-scale-${fontScale}`);
  }, [fontScale]);

  // Solicitar almacenamiento persistente del navegador y advertir si está limitado
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage
        .persisted()
        .then((already) => {
          if (already) {
            setStoragePersisted(true);
            return;
          }
          return navigator.storage.persist().then(setStoragePersisted);
        })
        .catch(() => setStoragePersisted(null));
    }
  }, []);

  // Escuchar cambios de conexión del navegador
  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, []);

  // Configurar sesión de Supabase Auth si existe configuración
  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
      setUserEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_ev, session) => {
      setUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Configurar el contexto de escritura de la base local y el motor de sincronización
  useEffect(() => {
    const sb = getSupabaseClient();
    const activeRemote: Remote | null =
      customRemote ?? (sb && userId ? new SupabaseRemote(sb) : null);

    configureDb(sharedDb, {
      deviceLabel,
      ownerId: userId,
      syncEnabled: Boolean(activeRemote),
    });

    engineRef.current = activeRemote ? new SyncEngine(sharedDb, activeRemote) : null;
  }, [deviceLabel, userId, customRemote]);

  // Inicialización: si la base está completamente vacía y no se ha configurado, sembrar datos de demostración
  useEffect(() => {
    let mounted = true;
    (async () => {
      const setupDone = await sharedDb.getMeta<boolean>('setup_completed');
      const instCount = await sharedDb.institutions.count();
      if (!setupDone && instCount === 0) {
        await seedDemoData(sharedDb);
      }
      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const triggerSync = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await engine.sync();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'No se pudo sincronizar en este momento');
    } finally {
      setSyncing(false);
    }
  }, []);

  // Sincronizar automáticamente al abrir, al recuperar conexión y tras cambios locales
  useEffect(() => {
    if (!ready || !online || !engineRef.current) return;
    triggerSync();
  }, [ready, online, userId, customRemote, triggerSync]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocalChange(() => {
      if (!engineRef.current || !online) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        triggerSync();
      }, 900);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [online, triggerSync]);

  const setCustomRemote = useCallback((remote: Remote | null, ownerId: string | null = 'usuario-local') => {
    setCustomRemoteState(remote);
    setUserId(remote ? ownerId : null);
    setUserEmail(remote ? 'profesora@colegio.edu.ec' : null);
  }, []);

  // Exponer gancho en `window` para pruebas funcionales E2E de múltiples dispositivos y desconexiones
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__milibreta = {
      db: sharedDb,
      triggerSync,
      setCustomRemote,
    };
  }, [triggerSync, setCustomRemote]);

  const signOut = useCallback(async () => {
    const sb = getSupabaseClient();
    if (sb) await sb.auth.signOut();
    setCustomRemoteState(null);
    setUserId(null);
    setUserEmail(null);
  }, []);

  const undoLastGradeChange = useCallback(async (): Promise<boolean> => {
    const latest = await sharedDb.local_revisions.orderBy('id').last();
    if (!latest || latest.table !== 'grades') return false;
    await sharedDb.local_revisions.delete(latest.id!);

    if (latest.before) {
      await save(sharedDb, 'grades', {
        id: latest.record_id,
        evaluation_id: latest.before.evaluation_id as string,
        student_id: latest.before.student_id as string,
        status: latest.before.status as 'empty' | 'graded' | 'absent' | 'pending',
        value: (latest.before.value as string | null) ?? null,
        qualitative: (latest.before.qualitative as string | null) ?? null,
      });
    } else {
      await save(sharedDb, 'grades', {
        id: latest.record_id,
        evaluation_id: latest.after.evaluation_id as string,
        student_id: latest.after.student_id as string,
        status: 'empty',
        value: null,
        qualitative: null,
      });
    }
    return true;
  }, []);

  const syncStatus: SyncStatus = useMemo(() => {
    if (conflictsCount > 0) return 'conflict';
    if (!engineRef.current) return 'local_only';
    if (!online) return 'offline';
    if (syncing) return 'syncing';
    if (syncError) return 'error';
    if (pendingCount > 0) return 'pending';
    return 'synced';
  }, [conflictsCount, online, syncing, syncError, pendingCount]);

  const value: AppContextValue = {
    db: sharedDb,
    ready,
    deviceLabel,
    setDeviceLabel,
    userEmail,
    userId,
    isCloudConfigured: isSupabaseConfigured() || Boolean(customRemote),
    syncStatus,
    pendingCount,
    conflictsCount,
    lastSyncAt: lastSyncMeta ?? null,
    syncError,
    storagePersisted,
    fontScale,
    setFontScale,
    triggerSync,
    signOut,
    undoLastGradeChange,
    canUndoGrade: revisionsCount > 0,
    setCustomRemote,
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-700">
        Preparando Mi Libreta…
      </div>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe utilizarse dentro de AppProvider');
  return ctx;
}
