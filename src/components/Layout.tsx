/**
 * Estructura general y navegación principal de 4 apartados:
 * - Inicio
 * - Mi Libreta
 * - Reportes
 * - Configuración
 *
 * Incluye indicador claro de estado de guardado («Guardado en este dispositivo» /
 * «Sincronizado» / «Sin conexión») y selector rápido de tamaño de letra.
 */
import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CloudOff,
  FileSpreadsheet,
  Home,
  Lock,
  RefreshCw,
  Settings,
  Smartphone,
  Type,
} from 'lucide-react';
import { useApp, type FontScale } from '../context/AppContext';
import { ConflictModal } from './ConflictModal';

export function Layout() {
  const {
    syncStatus,
    pendingCount,
    conflictsCount,
    triggerSync,
    fontScale,
    setFontScale,
    storagePersisted,
  } = useApp();

  const [showConflicts, setShowConflicts] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlockInput, setUnlockInput] = useState('');
  const [unlockError, setUnlockError] = useState('');

  const cycleFontScale = () => {
    const order: FontScale[] = ['normal', 'large', 'xlarge'];
    const next = order[(order.indexOf(fontScale) + 1) % order.length];
    setFontScale(next);
  };

  const fontLabel =
    fontScale === 'normal' ? 'Letra normal' : fontScale === 'large' ? 'Letra grande' : 'Letra muy grande';

  const savedPin = localStorage.getItem('milibreta_screen_pin');

  if (locked && savedPin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-100 p-2.5 text-teal-800">
              <Lock className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Mi Libreta bloqueada</h1>
              <p className="text-sm text-slate-600">Escriba su código de acceso rápido</p>
            </div>
          </div>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (unlockInput === savedPin) {
                setLocked(false);
                setUnlockInput('');
                setUnlockError('');
              } else {
                setUnlockError('Código incorrecto. Intente nuevamente.');
              }
            }}
          >
            <input
              type="password"
              inputMode="numeric"
              value={unlockInput}
              onChange={(e) => setUnlockInput(e.target.value)}
              placeholder="Código"
              aria-label="Código de desbloqueo"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-center text-xl tracking-widest focus:border-teal-700 focus:outline-none"
              autoFocus
            />
            {unlockError && <p className="text-sm font-medium text-red-700">{unlockError}</p>}
            <button
              type="submit"
              className="min-h-12 w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800"
            >
              Desbloquear
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {/* Cabecera superior */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 font-bold text-white">
              ML
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-900">Mi Libreta</span>
              <span className="ml-2 hidden rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline">
                Registro docente
              </span>
            </div>
          </div>

          {/* Indicador de estado de guardado y sincronización + controles rápidos */}
          <div className="flex flex-wrap items-center gap-2">
            {conflictsCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowConflicts(true)}
                data-testid="sync-conflict-badge"
                className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-200"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Revisar {conflictsCount} nota(s) diferente(s)</span>
              </button>
            ) : syncStatus === 'synced' ? (
              <div
                data-testid="sync-status-badge"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Sincronizado</span>
              </div>
            ) : syncStatus === 'syncing' ? (
              <div
                data-testid="sync-status-badge"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800"
              >
                <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                <span>Sincronizando…</span>
              </div>
            ) : syncStatus === 'offline' ? (
              <div
                data-testid="sync-status-badge"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900"
              >
                <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Sin internet · Guardado en este dispositivo
                  {pendingCount > 0 ? ` (${pendingCount})` : ''}
                </span>
              </div>
            ) : syncStatus === 'pending' || syncStatus === 'error' ? (
              <button
                type="button"
                onClick={() => triggerSync()}
                data-testid="sync-status-badge"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Guardado en este dispositivo ({pendingCount} pendiente)</span>
              </button>
            ) : (
              <div
                data-testid="sync-status-badge"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Guardado en este dispositivo</span>
              </div>
            )}

            <button
              type="button"
              onClick={cycleFontScale}
              title="Cambiar tamaño de letra"
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              <Type className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{fontLabel}</span>
            </button>

            {savedPin && (
              <button
                type="button"
                onClick={() => setLocked(true)}
                title="Bloquear pantalla en equipo compartido"
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline">Bloquear</span>
              </button>
            )}
          </div>
        </div>

        {/* Navegación en pantallas medianas y grandes */}
        <nav
          aria-label="Navegación principal"
          className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 sm:flex"
        >
          <NavItem to="/" icon={<Home className="h-5 w-5" />} label="Inicio" end />
          <NavItem to="/libreta" icon={<BookOpen className="h-5 w-5" />} label="Mi Libreta" />
          <NavItem to="/reportes" icon={<FileSpreadsheet className="h-5 w-5" />} label="Reportes" />
          <NavItem to="/configuracion" icon={<Settings className="h-5 w-5" />} label="Configuración" />
        </nav>
      </header>

      {/* Advertencia discreta si el navegador no garantizó persistencia ilimitada */}
      {storagePersisted === false && (
        <div className="no-print bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Sugerencia: instale Mi Libreta en su pantalla de inicio o descargue un respaldo periódico en
          Configuración para proteger sus notas si limpia el navegador.
        </div>
      )}

      {/* Contenido principal */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 sm:pb-10">
        <Outlet />
      </main>

      {/* Barra de navegación inferior para celular (objetivos táctiles >= 44x44px) */}
      <nav
        aria-label="Navegación móvil"
        className="no-print fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white sm:hidden"
      >
        <MobileNavItem to="/" icon={<Home className="h-5 w-5" />} label="Inicio" end />
        <MobileNavItem to="/libreta" icon={<BookOpen className="h-5 w-5" />} label="Mi Libreta" />
        <MobileNavItem to="/reportes" icon={<FileSpreadsheet className="h-5 w-5" />} label="Reportes" />
        <MobileNavItem to="/configuracion" icon={<Settings className="h-5 w-5" />} label="Configuración" />
      </nav>

      {showConflicts && <ConflictModal onClose={() => setShowConflicts(false)} />}
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
          isActive
            ? 'bg-teal-700 text-white shadow-xs'
            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function MobileNavItem({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-semibold ${
          isActive ? 'text-teal-700' : 'text-slate-600'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
