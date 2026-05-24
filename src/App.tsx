/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  auth, db, handleFirestoreError, OperationType 
} from './lib/firebase';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut, signInWithEmailAndPassword 
} from 'firebase/auth';
import { 
  doc, setDoc, getDoc, collection, onSnapshot, addDoc, query, orderBy, limit, serverTimestamp, Timestamp, getDocs, deleteDoc 
} from 'firebase/firestore';
import { 
  LayoutDashboard, Key, Calendar, Settings, Bell, LogIn, LogOut, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Search, Filter, Home, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BuildingConfig, KeyStatus, KeyLog, Visit, VisitorType, VisitStatus, Admin } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'keys' | 'visits' | 'setup' | 'history' | 'reports'>('dashboard');
  
  // Data state
  const [config, setConfig] = useState<BuildingConfig | null>(null);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({});
  const [recentLogs, setRecentLogs] = useState<KeyLog[]>([]);
  const [upcomingVisits, setUpcomingVisits] = useState<Visit[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'info' } | null>(null);
  
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  const upcomingVisitsRef = useRef<string[]>([]);
  const logsRef = useRef<string[]>([]);

  // Firestore listeners
  useEffect(() => {
    if (!user) return;

    // Listen to config
    const unsubConfig = onSnapshot(doc(db, 'settings', 'global'), (doc) => {
      if (doc.exists()) {
        setConfig(doc.data() as BuildingConfig);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, 'settings/global'));

    // Listen to key statuses
    const unsubKeys = onSnapshot(collection(db, 'keyStatus'), (snapshot) => {
      const statuses: Record<string, KeyStatus> = {};
      snapshot.forEach((doc) => {
        statuses[doc.id] = doc.data() as KeyStatus;
      });
      setKeyStatuses(statuses);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'keyStatus'));

    // Listen to recent logs
    const qLogs = query(collection(db, 'keyLogs'), orderBy('timestamp', 'desc'), limit(10));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const logs: KeyLog[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as KeyLog;
        logs.push({ id: doc.id, ...data });
        
        // Notification logic for new logs
        if (logsRef.current.length > 0 && !logsRef.current.includes(doc.id)) {
          setToast({ 
            message: `Chave ${data.apartmentId}: ${data.type === 'Checkout' ? 'Saída' : 'Entrada'} por ${data.holder}`, 
            type: 'info' 
          });
        }
      });
      logsRef.current = logs.map(l => l.id);
      setRecentLogs(logs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'keyLogs'));

    // Listen to visits
    const qVisits = query(collection(db, 'visits'), orderBy('scheduledAt', 'asc'), limit(50));
    const unsubVisits = onSnapshot(qVisits, (snapshot) => {
      const visits: Visit[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as Visit;
        visits.push({ id: doc.id, ...data });

        // Notification logic for new visits
        if (upcomingVisitsRef.current.length > 0 && !upcomingVisitsRef.current.includes(doc.id)) {
          setToast({ 
            message: `Nova visita agendada: Apt ${data.apartmentId} - ${data.visitorName}`, 
            type: 'success' 
          });
        }
      });
      upcomingVisitsRef.current = visits.map(v => v.id);
      setUpcomingVisits(visits);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'visits'));

    // Listen to admins
    const unsubAdmins = onSnapshot(collection(db, 'admins'), (snapshot) => {
      const adminList: Admin[] = [];
      const masterEmails = ['l2xbrasil@gmail.com', 'l2jsites@gmail.com'];
      let currentUserIsAdmin = masterEmails.includes(user.email || '');
      
      snapshot.forEach((doc) => {
        const data = doc.data() as Admin;
        adminList.push({ id: doc.id, ...data });
        if (data.email === user.email) currentUserIsAdmin = true;
      });
      setAdmins(adminList);
      setIsAdmin(currentUserIsAdmin);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'admins'));

    return () => {
      unsubConfig();
      unsubKeys();
      unsubLogs();
      unsubVisits();
      unsubAdmins();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    setLoginError('');
    setIsLoginLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
      setLoginError('Falha no login com Google.');
    } finally {
      setIsLoginLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (error: any) {
      console.error("Login failed", error);
      setLoginError(error.code === 'auth/invalid-credential' 
        ? 'Email ou senha incorretos.' 
        : 'Ocorreu um erro ao tentar fazer login.');
    } finally {
      setIsLoginLoading(false);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-slate-200 border border-slate-100 p-8 text-center"
        >
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
            <Key className="text-white w-10 h-10" />
          </div>
          <h1 className="text-3xl font-heading font-bold text-slate-900 mb-2">Gerenciador de Chaves</h1>
          <p className="text-slate-500 mb-8">Controle de chaves e agendamento para condomínios modernos.</p>
          
          <form onSubmit={handleEmailLogin} className="space-y-4 mb-6 text-left">
            {loginError && (
              <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium text-center border border-red-100">
                {loginError}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Email</label>
              <input 
                type="email" required placeholder="seu@email.com"
                value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none bg-slate-50/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Senha</label>
              <input 
                type="password" required placeholder="Sua senha"
                value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none bg-slate-50/50"
              />
            </div>
            <button
              type="submit"
              disabled={isLoginLoading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-100 font-bold disabled:opacity-50 mt-2"
            >
              {isLoginLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-4 text-slate-400 uppercase tracking-widest font-black">Ou</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogin}
            disabled={isLoginLoading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 text-slate-700 py-3 rounded-xl hover:bg-slate-50 transition-colors font-medium disabled:opacity-50"
          >
            <LogIn className="w-5 h-5" />
            Entrar com Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8 overflow-hidden">
            <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-100">
                <Key className="text-white w-6 h-6" />
              </div>
              <span className="hidden lg:block text-xl font-heading font-bold text-slate-800">Gerenciador</span>
            </div>

            {/* Desktop Horizontal Nav */}
            <nav className="hidden md:flex items-center gap-1 overflow-x-auto no-scrollbar">
              <NavItem 
                icon={<LayoutDashboard size={18} />} 
                label="Dashboard" 
                active={activeTab === 'dashboard'} 
                onClick={() => setActiveTab('dashboard')} 
                horizontal
              />
              <NavItem 
                icon={<Key size={18} />} 
                label="Chaves" 
                active={activeTab === 'keys'} 
                onClick={() => setActiveTab('keys')} 
                horizontal
              />
              <NavItem 
                icon={<Calendar size={18} />} 
                label="Visitas" 
                active={activeTab === 'visits'} 
                onClick={() => setActiveTab('visits')} 
                horizontal
              />
              <NavItem 
                icon={<History size={18} />} 
                label="Histórico" 
                active={activeTab === 'history'} 
                onClick={() => setActiveTab('history')} 
                horizontal
              />
              <NavItem 
                icon={<Filter size={18} />} 
                label="Relatórios" 
                active={activeTab === 'reports'} 
                onClick={() => setActiveTab('reports')} 
                horizontal
              />
              <NavItem 
                icon={<Settings size={18} />} 
                label="Configurar" 
                active={activeTab === 'setup'} 
                onClick={() => setActiveTab('setup')} 
                horizontal
              />
            </nav>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-3 pr-3 border-r border-slate-100">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-700 truncate max-w-[120px]">{user.displayName || user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-slate-400 truncate max-w-[120px]">{user.email}</p>
              </div>
              <div className="sm:hidden text-right">
                <p className="text-xs font-bold text-slate-700 truncate max-w-[100px]">{user.displayName || user.email?.split('@')[0]}</p>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-slate-200 ring-2 ring-slate-50 object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold uppercase ring-2 ring-slate-50">
                  {(user.displayName || user.email || '?').charAt(0)}
                </div>
              )}
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

          {/* Mobile Nav Bar - Scrollable */}
        <div className="md:hidden flex items-center gap-1 px-4 py-2 bg-white border-t border-slate-50 overflow-x-auto no-scrollbar scroll-smooth">
          <NavItem icon={<LayoutDashboard size={18} />} label="Início" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} horizontal small />
          <NavItem icon={<Key size={18} />} label="Chaves" active={activeTab === 'keys'} onClick={() => setActiveTab('keys')} horizontal small />
          <NavItem icon={<Calendar size={18} />} label="Visitas" active={activeTab === 'visits'} onClick={() => setActiveTab('visits')} horizontal small />
          <NavItem icon={<History size={18} />} label="Log" active={activeTab === 'history'} onClick={() => setActiveTab('history')} horizontal small />
          <NavItem icon={<Filter size={18} />} label="Relats" active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} horizontal small />
          <NavItem icon={<Settings size={18} />} label="Set" active={activeTab === 'setup'} onClick={() => setActiveTab('setup')} horizontal small />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && <Dashboard keyStatuses={keyStatuses} recentLogs={recentLogs} visits={upcomingVisits} config={config} />}
          {activeTab === 'keys' && <KeyManagement config={config} keyStatuses={keyStatuses} isAdmin={isAdmin} setToast={setToast} />}
          {activeTab === 'visits' && <VisitsManagement visits={upcomingVisits} config={config} isAdmin={isAdmin} />}
          {activeTab === 'reports' && <ReportsView />}
          {activeTab === 'setup' && <SetupView config={config} admins={admins} isAdmin={isAdmin} currentUser={user} />}
          {activeTab === 'history' && <HistoryView logs={recentLogs} />}
        </AnimatePresence>
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className={cn(
              "fixed bottom-6 right-6 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border",
              toast.type === 'success' ? "bg-emerald-600 border-emerald-500 text-white" : "bg-blue-600 border-blue-500 text-white"
            )}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <Bell size={20} />}
            <span className="text-sm font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, horizontal, small }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, horizontal?: boolean, small?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 transition-all duration-200 group flex-shrink-0 relative",
        horizontal 
          ? (small ? "px-3 py-2 rounded-xl" : "px-4 py-2 rounded-xl")
          : "w-full px-3 py-2.5 rounded-xl",
        active 
          ? "bg-blue-50 text-blue-600 font-bold shadow-sm" 
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      <div className={cn("transition-transform group-hover:scale-110 flex-shrink-0", active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600")}>
        {icon}
      </div>
      <span className={cn("whitespace-nowrap transition-all", small ? "text-[11px] font-bold" : "text-sm font-semibold")}>{label}</span>
      {!horizontal && active && <motion.div layoutId="nav-pill" className="ml-auto w-1.5 h-1.5 bg-blue-600 rounded-full" />}
      {horizontal && active && <motion.div layoutId="nav-pill-h" className="absolute -bottom-2 left-2 right-2 h-0.5 bg-blue-600 rounded-full md:hidden" />}
    </button>
  );
}

// --- Views ---

function Dashboard({ keyStatuses, recentLogs, visits, config }: { keyStatuses: Record<string, KeyStatus>, recentLogs: KeyLog[], visits: Visit[], config: BuildingConfig | null }) {
  const allKeys = Object.values(keyStatuses);
  const outCount = allKeys.filter(k => k.isOut).length;
  const overdueCount = allKeys.filter(k => k.isOut && k.returnDeadline && new Date(k.returnDeadline) < new Date()).length;
  const inCount = (config ? config.floors * config.aptsPerFloor : 0) - outCount;
  const todayVisits = visits.filter(v => {
    const d = new Date(v.scheduledAt);
    const today = new Date();
    return d.toDateString() === today.toDateString() && v.status === 'Scheduled';
  }).length;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8">
      <header className="mb-2 md:mb-8">
        <h2 className="text-2xl md:text-3xl font-heading font-bold text-slate-900">Configurações Base</h2>
        <p className="text-slate-500 text-xs md:text-sm">Resumo operacional do condomínio.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        <StatCard title="Chaves Fora" value={outCount} icon={<Key className="text-orange-600" size={20} />} color="bg-orange-50" />
        <StatCard title="Atrasadas" value={overdueCount} icon={<Bell className={cn(overdueCount > 0 ? "text-red-600 animate-bounce" : "text-slate-400")} size={20} />} color={overdueCount > 0 ? "bg-red-50" : "bg-slate-50"} />
        <StatCard title="Disponíveis" value={inCount} icon={<CheckCircle2 className="text-emerald-600" size={20} />} color="bg-emerald-50" />
        <StatCard title="Hoje" value={todayVisits} icon={<Calendar className="text-blue-600" size={20} />} color="bg-blue-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-[2rem] md:rounded-3xl p-5 md:p-6 border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <h3 className="text-base md:text-lg font-bold flex items-center gap-2">
              <Bell size={18} className="text-slate-400" />
              Atividade Recente
            </h3>
          </div>
          <div className="space-y-4">
            {recentLogs.length > 0 ? recentLogs.map(log => (
              <div key={log.id} className="flex gap-3 md:gap-4 items-start pb-4 border-b border-slate-50 last:border-0 last:pb-0">
                <div className={cn(
                  "p-2 rounded-lg shrink-0",
                  log.type === 'Checkout' ? "bg-orange-100 text-orange-600" : "bg-emerald-100 text-emerald-600"
                )}>
                  {log.type === 'Checkout' ? <LogOut size={16} /> : <LogIn size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug break-words">
                    <span className="text-blue-600 font-bold">Apt {log.apartmentId}</span> {log.type === 'Checkout' ? 'retirada' : 'devolvida'} por {log.holder}
                  </p>
                  <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">{format(new Date(log.timestamp), "HH:mm 'de' d/MM", { locale: ptBR })}</p>
                </div>
              </div>
            )) : (
              <p className="text-sm text-slate-400 text-center py-8">Nenhuma atividade registrada.</p>
            )}
          </div>
        </div>

        {/* Upcoming Visits */}
        <div className="bg-white rounded-[2rem] md:rounded-3xl p-5 md:p-6 border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <h3 className="text-base md:text-lg font-bold flex items-center gap-2">
              <Calendar size={18} className="text-slate-400" />
              Próximas Visitas
            </h3>
          </div>
          <div className="space-y-3 md:space-y-4">
            {visits.filter(v => v.status === 'Scheduled').slice(0, 5).map(visit => (
              <div key={visit.id} className="flex items-center gap-3 md:gap-4 p-3 bg-slate-50 rounded-2xl">
                <div className="w-10 md:w-12 text-center border-r border-slate-200 pr-3 md:pr-4 shrink-0">
                  <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase">{format(new Date(visit.scheduledAt), 'MMM', { locale: ptBR })}</p>
                  <p className="text-base md:text-lg font-bold text-slate-800 leading-tight">{format(new Date(visit.scheduledAt), 'dd')}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{visit.visitorName}</p>
                  <p className="text-[10px] md:text-xs text-slate-500 truncate">Apt {visit.apartmentId} • {visit.visitorType === 'Resident' ? 'Morador' : 'Empresa'}</p>
                </div>
                <div className="text-[10px] md:text-xs font-medium bg-white px-2 py-1 rounded-md border border-slate-100 italic shrink-0">
                  {format(new Date(visit.scheduledAt), 'HH:mm')}
                </div>
              </div>
            ))}
            {visits.filter(v => v.status === 'Scheduled').length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">Nenhuma visita agendada.</p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StatCard({ title, value, icon, color }: { title: string, value: number, icon: React.ReactNode, color: string }) {
  return (
    <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4 md:gap-6">
      <div className={cn("w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center flex-shrink-0", color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] md:text-sm text-slate-500 font-medium truncate">{title}</p>
        <p className="text-lg md:text-2xl font-bold font-heading">{value}</p>
      </div>
    </div>
  );
}

function SetupView({ config, admins, isAdmin, currentUser }: { config: BuildingConfig | null, admins: Admin[], isAdmin: boolean, currentUser: User }) {
  const [floors, setFloors] = useState(config?.floors || 5);
  const [apts, setApts] = useState(config?.aptsPerFloor || 4);
  const [maxKeysOut, setMaxKeysOut] = useState(config?.maxKeysOut || 0); // 0 means no limit
  const [saving, setSaving] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  useEffect(() => {
    if (config) {
      setFloors(config.floors);
      setApts(config.aptsPerFloor);
      setMaxKeysOut(config.maxKeysOut || 0);
    }
  }, [config]);

  const saveConfig = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        floors,
        aptsPerFloor: apts,
        maxKeysOut,
        updatedAt: new Date().toISOString()
      });
      alert("Configurações atualizadas com sucesso!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    } finally {
      setSaving(false);
    }
  };

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newAdminEmail.trim()) return;

    try {
      const emailId = newAdminEmail.toLowerCase().trim();
      await setDoc(doc(db, 'admins', emailId), {
        email: emailId,
        name: newAdminName || emailId.split('@')[0],
        addedAt: new Date().toISOString(),
        addedBy: currentUser.email
      });
      setNewAdminEmail('');
      setNewAdminName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'admins');
    }
  };

  const updateAdmin = async (id: string, originalEmail: string) => {
    if (!isAdmin || !editName.trim() || !editEmail.trim()) return;
    
    const newEmail = editEmail.toLowerCase().trim();
    const masterEmails = ['l2xbrasil@gmail.com', 'l2jsites@gmail.com'];
    
    if (masterEmails.includes(originalEmail) && newEmail !== originalEmail) {
      alert("Emails de administradores Master não podem ser alterados.");
      setEditingAdminId(null);
      return;
    }

    try {
      if (newEmail !== originalEmail) {
        // If email changed, we need to create a new doc and delete the old one
        await setDoc(doc(db, 'admins', newEmail), {
          email: newEmail,
          name: editName.trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.email
        });
        await deleteDoc(doc(db, 'admins', originalEmail));
      } else {
        // Just update name
        await setDoc(doc(db, 'admins', originalEmail), { 
          name: editName.trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.email
        }, { merge: true });
      }
      setEditingAdminId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'admins/' + originalEmail);
    }
  };

  const removeAdmin = async (id: string, email: string) => {
    if (!isAdmin) return;
    const masterEmails = ['l2xbrasil@gmail.com', 'l2jsites@gmail.com'];
    if (masterEmails.includes(email)) {
      alert("Administradores Master não podem ser removidos.");
      return;
    }
    if (!confirm(`Deseja revogar o acesso de administrador para ${email}?`)) return;
    try {
      await deleteDoc(doc(db, 'admins', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'admins/' + id);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="max-w-4xl mx-auto space-y-8 pb-10"
    >
      <header className="mb-2 md:mb-8">
        <h2 className="text-2xl md:text-3xl font-bold font-heading text-slate-900">Configurações do Sistema</h2>
        <p className="text-slate-500 text-xs md:text-sm">Personalize a estrutura do prédio e gerencie permissões de acesso.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Physical Structure Card */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
          <div className="p-6 border-b border-slate-50 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                <Home size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Infraestrutura</h3>
                <p className="text-xs text-slate-500">Divisão de andares e unidades</p>
              </div>
            </div>
          </div>
          
          <div className="p-6 flex-1 space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-tight">Total de Andares</label>
                <span className="text-2xl font-bold text-blue-600 font-heading">{floors}</span>
              </div>
              <input 
                type="range" min="1" max="50" step="1" 
                value={floors} onChange={(e) => setFloors(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                disabled={!isAdmin}
              />
              <p className="text-[10px] text-slate-400">Arraste para ajustar. Máximo de 50 andares suportados.</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-tight">Aptos por Andar</label>
                <span className="text-2xl font-bold text-blue-600 font-heading">{apts}</span>
              </div>
              <input 
                type="range" min="1" max="24" step="1" 
                value={apts} onChange={(e) => setApts(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                disabled={!isAdmin}
              />
              <p className="text-[10px] text-slate-400">Influencia a grade visual de chaves no painel principal.</p>
            </div>

            <div className="space-y-4 text-center">
              <div className="flex justify-between items-end">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-tight">Limite de Chaves Fora</label>
                <span className="text-2xl font-bold text-blue-600 font-heading">{maxKeysOut === 0 ? 'ILIMITADO' : maxKeysOut}</span>
              </div>
              <input 
                type="range" min="0" max="100" step="1" 
                value={maxKeysOut} onChange={(e) => setMaxKeysOut(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                disabled={!isAdmin}
              />
              <p className="text-[10px] text-slate-400 italic">Limite simultâneo de chaves entregues. 0 = sem restrição.</p>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex gap-3">
              <Bell className="text-blue-500 shrink-0" size={18} />
              <p className="text-[11px] text-blue-700 leading-relaxed">
                <strong>Atenção:</strong> Alterar a estrutura criará novos slots de chaves instantaneamente para a equipe de portaria.
              </p>
            </div>
          </div>

          <div className="p-6 pt-0">
            <button 
              onClick={saveConfig}
              disabled={saving || !isAdmin}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {saving ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Salvando...
                </div>
              ) : 'Aplicar Alterações Estruturais'}
            </button>
          </div>
        </div>

        {/* Administration Access Card */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
          <div className="p-6 border-b border-slate-50 bg-purple-50/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center">
                <Settings size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Equipe de Gestão</h3>
                <p className="text-xs text-slate-500">Controle de quem acessa este menu</p>
              </div>
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col">
            {isAdmin && (
              <form onSubmit={addAdmin} className="space-y-3 mb-8">
                <div className="grid grid-cols-1 gap-3">
                  <input 
                    type="email" required placeholder="Email do novo administrador"
                    value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all bg-slate-50/30"
                  />
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <input 
                      type="text" placeholder="Nome identficador"
                      value={newAdminName} onChange={e => setNewAdminName(e.target.value)}
                      className="flex-1 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all bg-slate-50/30"
                    />
                    <button type="submit" className="bg-purple-600 text-white py-3 sm:py-0 px-5 rounded-xl font-bold hover:bg-purple-700 transition-all shadow-md shadow-purple-50">
                      Convidar
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="space-y-4 flex-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Membros Vinculados</h4>
                <span className="text-[10px] text-slate-400">{admins.length + 1} Administradores</span>
              </div>
              
              <div className="space-y-3">
                {/* Always show masters first */}
                {['l2xbrasil@gmail.com', 'l2jsites@gmail.com'].map(email => {
                  const admin = admins.find(a => a.email === email) || { id: email, email, name: '' } as Admin;
                  return (
                    <div key={email} className={cn(
                      "flex flex-col p-3 rounded-2xl border transition-all group",
                      editingAdminId === admin.id ? "bg-purple-50/50 border-purple-200 shadow-sm" : "bg-blue-50/50 border-blue-100/50 animate-pulse-once"
                    )}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold capitalize shrink-0",
                            editingAdminId === admin.id ? "bg-purple-600 text-white" : "bg-blue-600 text-white"
                          )}>
                            {(editingAdminId === admin.id ? editName : admin.name)?.charAt(0) || email.charAt(0)}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            {editingAdminId === admin.id ? (
                              <div className="space-y-1">
                                <input 
                                  autoFocus
                                  value={editName}
                                  onChange={e => setEditName(e.target.value)}
                                  placeholder="Nome"
                                  className="text-xs font-bold text-slate-700 border-b border-purple-300 outline-none bg-transparent w-full"
                                />
                                <input 
                                  value={editEmail}
                                  disabled
                                  className="text-[10px] text-slate-500 bg-transparent w-full italic"
                                />
                              </div>
                            ) : (
                              <>
                                <p className="text-xs font-bold text-slate-800 truncate">{admin.name || 'Master Admin'}</p>
                                <p className="text-[10px] text-blue-600/70 font-mono italic truncate">{email}</p>
                              </>
                            )}
                          </div>
                        </div>

                        {isAdmin && (
                          <div className="flex gap-1 shrink-0 items-center">
                            {editingAdminId === admin.id ? (
                              <div className="flex flex-col gap-1">
                                <button 
                                  onClick={() => updateAdmin(admin.id, admin.email)}
                                  className="p-1 px-3 text-white bg-purple-600 rounded-lg text-[9px] font-bold shadow-sm shadow-purple-100"
                                >
                                  Salvar
                                </button>
                                <button 
                                  onClick={() => setEditingAdminId(null)}
                                  className="p-1 px-3 text-slate-500 bg-white border border-slate-200 rounded-lg text-[9px] font-bold"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="text-[9px] font-black uppercase text-blue-600 px-1.5 py-0.5 border border-blue-200 rounded mr-1">Master</span>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => {
                                      setEditingAdminId(admin.id);
                                      setEditName(admin.name || '');
                                      setEditEmail(admin.email);
                                    }}
                                    className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Editar"
                                  >
                                    <Settings size={14} />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {admins.filter(a => !['l2xbrasil@gmail.com', 'l2jsites@gmail.com'].includes(a.email)).map(admin => (
                  <div key={admin.id} className={cn(
                    "flex flex-col p-3 rounded-2xl border transition-all group",
                    editingAdminId === admin.id ? "bg-purple-50/50 border-purple-200 shadow-sm" : "border-slate-50 hover:bg-slate-50/30"
                  )}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold capitalize shrink-0",
                          editingAdminId === admin.id ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-500"
                        )}>
                          {(editingAdminId === admin.id ? editName : admin.name)?.charAt(0) || admin.email.charAt(0)}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          {editingAdminId === admin.id ? (
                            <div className="space-y-1">
                              <input 
                                autoFocus
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                placeholder="Nome"
                                className="text-xs font-bold text-slate-700 border-b border-purple-300 outline-none bg-transparent w-full"
                              />
                              <input 
                                value={editEmail}
                                onChange={e => setEditEmail(e.target.value)}
                                placeholder="Email"
                                className="text-[10px] text-slate-500 border-b border-purple-200 outline-none bg-transparent w-full italic"
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-bold text-slate-700 truncate">{admin.name || admin.email.split('@')[0]}</p>
                                {admin.email === currentUser.email && (
                                  <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-bold uppercase tracking-tight">Você</span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 italic truncate">{admin.email}</p>
                            </>
                          )}
                        </div>
                      </div>

                      {isAdmin && (
                        <div className="flex gap-1 shrink-0">
                          {editingAdminId === admin.id ? (
                            <div className="flex flex-col gap-1">
                              <button 
                                onClick={() => updateAdmin(admin.id, admin.email)}
                                className="p-1 px-3 text-white bg-purple-600 rounded-lg text-[9px] font-bold shadow-sm shadow-purple-100"
                              >
                                Salvar
                              </button>
                              <button 
                                onClick={() => setEditingAdminId(null)}
                                className="p-1 px-3 text-slate-500 bg-white border border-slate-200 rounded-lg text-[9px] font-bold"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => {
                                  setEditingAdminId(admin.id);
                                  setEditName(admin.name || '');
                                  setEditEmail(admin.email);
                                }}
                                className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Editar"
                              >
                                <Settings size={14} />
                              </button>
                              {admin.email !== currentUser.email && (
                                <button 
                                  onClick={() => removeAdmin(admin.id, admin.email)}
                                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Remover"
                                >
                                  <XCircle size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function KeyManagement({ config, keyStatuses, isAdmin, setToast }: { config: BuildingConfig | null, keyStatuses: Record<string, KeyStatus>, isAdmin: boolean, setToast: (t: { message: string, type: 'success' | 'info' }) => void }) {
  const [filter, setFilter] = useState('');
  const [selectedApt, setSelectedApt] = useState<string | null>(null);

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Settings className="text-slate-200 w-20 h-20 mb-4" />
        <h3 className="text-xl font-bold text-slate-400">Configuração Inicial Necessária</h3>
        <p className="text-slate-400 max-w-sm">Acesse a aba 'Configurar' para definir a estrutura do condomínio antes de gerenciar as chaves.</p>
      </div>
    );
  }

  const apartments = [];
  for (let f = 1; f <= config.floors; f++) {
    for (let a = 1; a <= config.aptsPerFloor; a++) {
      const aptId = `${f}${a.toString().padStart(2, '0')}`;
      if (filter && !aptId.includes(filter)) continue;
      apartments.push(aptId);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h2 className="text-xl md:text-2xl font-bold font-heading">Painel de Chaves</h2>
          <p className="text-slate-500 text-xs md:text-sm">Gerencie a entrega e devolução em tempo real.</p>
        </div>
        <div className="relative max-w-xs w-full lg:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" placeholder="Buscar apartamento..." 
            value={filter} onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl py-2 md:py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
          />
        </div>
      </header>

      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8 gap-3 md:gap-4">
        {apartments.map(aptId => {
          const status = keyStatuses[aptId];
          const isOut = status?.isOut;
          const isOverdue = isOut && status?.returnDeadline && new Date(status.returnDeadline) < new Date();

          return (
            <motion.button 
              key={aptId} 
              onClick={() => setSelectedApt(aptId)}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "group relative p-4 rounded-2xl border transition-all duration-300 text-center",
                isOut 
                  ? (isOverdue ? "bg-red-50 border-red-200 text-red-800" : "bg-orange-50 border-orange-100 text-orange-800") 
                  : "bg-white border-slate-100 hover:border-blue-200 hover:shadow-lg hover:shadow-slate-100 shadow-sm"
              )}
            >
              <div className="mb-2">
                <motion.div
                  animate={isOut ? { scale: 1, rotate: 0 } : { scale: [1, 1.3, 1], rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 0.5, ease: "backOut" }}
                >
                  <Key 
                    size={20} 
                    className={cn(
                      "mx-auto", 
                      isOut 
                        ? (isOverdue ? "text-red-400" : "text-orange-400") 
                        : "text-emerald-500 group-hover:text-emerald-600 transition-colors"
                    )} 
                  />
                </motion.div>
              </div>
              <span className="text-lg font-bold font-heading">{aptId}</span>
              {isOut && <div className="mt-1 flex justify-center"><div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", isOverdue ? "bg-red-500" : "bg-orange-500")} /></div>}
              
              {isOut && (
                <div className={cn("absolute -top-2 -right-2 text-white p-1 rounded-full border-2 border-white shadow-sm", isOverdue ? "bg-red-600" : "bg-orange-500")}>
                  {isOverdue ? <Bell size={10} /> : <LogOut size={10} />}
                </div>
              )}
              {isOut && status.returnDeadline && (
                <div className="mt-1 text-[10px] font-bold opacity-70">
                  Prazo: {format(new Date(status.returnDeadline), 'HH:mm')}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedApt && (
          <KeyActionModal 
            aptId={selectedApt} 
            status={keyStatuses[selectedApt]} 
            onClose={() => setSelectedApt(null)} 
            isAdmin={isAdmin}
            setToast={setToast}
            config={config}
            keysOutCount={Object.values(keyStatuses).filter(k => k.isOut).length}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function KeyActionModal({ aptId, status, onClose, isAdmin, setToast, config, keysOutCount }: { aptId: string, status?: KeyStatus, onClose: () => void, isAdmin: boolean, setToast: (t: { message: string, type: 'success' | 'info' }) => void, config: BuildingConfig | null, keysOutCount: number }) {
  const [holder, setHolder] = useState(status?.currentHolder || '');
  const [type, setType] = useState<VisitorType>(status?.holderType || 'Resident');
  const [deadline, setDeadline] = useState(status?.returnDeadline || '');
  const [loading, setLoading] = useState(false);

  const handleAction = async (isReturn: boolean) => {
    if (!isAdmin) {
      alert("Apenas administradores podem realizar esta ação.");
      return;
    }
    
    if (!isReturn) {
      if (!holder.trim()) {
        alert("Por favor, informe quem está retirando a chave.");
        return;
      }

      // Limit check
      if (config?.maxKeysOut && config.maxKeysOut > 0 && keysOutCount >= config.maxKeysOut) {
        alert(`O limite máximo de ${config.maxKeysOut} chaves fora simultaneamente foi atingido. Devolva uma chave antes de retirar outra.`);
        return;
      }
    }

    setLoading(true);
    try {
      const now = new Date().toISOString();
      
      // Update key status
      await setDoc(doc(db, 'keyStatus', aptId), {
        apartmentId: aptId,
        isOut: !isReturn,
        currentHolder: isReturn ? null : holder,
        holderType: isReturn ? null : type,
        outAt: isReturn ? status?.outAt : now,
        returnDeadline: isReturn ? null : (deadline ? new Date(deadline).toISOString() : null),
        lastReturnedAt: isReturn ? now : status?.lastReturnedAt || null
      }, { merge: true });

      // Add to logs
      await addDoc(collection(db, 'keyLogs'), {
        apartmentId: aptId,
        holder: isReturn ? status?.currentHolder : holder,
        holderType: isReturn ? status?.holderType : type,
        type: isReturn ? 'Checkin' : 'Checkout',
        timestamp: now
      });

      if (isReturn) {
        setToast({ message: `Chave do Apt ${aptId} devolvida com sucesso!`, type: 'success' });
      } else {
        setToast({ message: `Chave do Apt ${aptId} entregue para ${holder}`, type: 'info' });
      }

      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'keyStatus/' + aptId);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-white/20 rounded-full sm:hidden" />
        
        <div className={cn(
          "p-6 sm:p-8 pt-10 sm:pt-10 text-white text-center",
          status?.isOut ? "bg-emerald-600" : "bg-orange-600"
        )}>
          <h3 className="text-2xl sm:text-3xl font-bold font-heading mb-1">Apt {aptId}</h3>
          <p className="text-white/80 text-xs sm:text-sm uppercase tracking-widest font-black">
            {status?.isOut ? 'Devolução de Chave' : 'Retirada de Chave'}
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {!status?.isOut ? (
            <>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Responsável pela retirada</label>
                  <input 
                    type="text" placeholder="Ex: João da Silva" 
                    value={holder} onChange={e => setHolder(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-slate-50/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Tipo de vínculo</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setType('Resident')}
                      className={cn(
                        "py-2.5 px-3 rounded-xl border text-sm font-bold transition-all",
                        type === 'Resident' ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      Morador
                    </button>
                    <button 
                      onClick={() => setType('Renovation Company')}
                      className={cn(
                        "py-2.5 px-3 rounded-xl border text-sm font-bold transition-all",
                        type === 'Renovation Company' ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      Empresa/Prestador
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Prazo p/ Devolução (Opcional)</label>
                  <input 
                    type="datetime-local" 
                    value={deadline} onChange={e => setDeadline(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-slate-50/50"
                  />
                </div>
              </div>

              <button 
                onClick={() => handleAction(false)}
                disabled={loading}
                className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-100 disabled:opacity-50 active:scale-[0.98]"
              >
                {loading ? 'Processando...' : 'Confirmar Retirada'}
              </button>
            </>
          ) : (
            <div className="space-y-6 pt-2 pb-4 text-center">
              <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Chave está com</p>
                <p className="text-xl font-bold text-slate-800">{status.currentHolder}</p>
                <div className="mt-2 inline-flex items-center gap-1.5 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">{status.holderType}</p>
                </div>
              </div>
              <button 
                onClick={() => handleAction(true)}
                disabled={loading}
                className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 active:scale-[0.98]"
              >
                {loading ? 'Processando...' : 'Confirmar Devolução'}
              </button>
            </div>
          )}
          
          <button 
            onClick={onClose}
            className="w-full text-slate-400 text-sm font-bold hover:text-slate-600 transition-colors pb-2 sm:pb-0"
          >
            Fechar Janela
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function VisitsManagement({ visits, config, isAdmin }: { visits: Visit[], config: BuildingConfig | null, isAdmin: boolean }) {
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const filteredVisits = visits.filter(v => 
    v.visitorName.toLowerCase().includes(filter.toLowerCase()) || 
    v.apartmentId.includes(filter)
  ).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const totalPages = Math.ceil(filteredVisits.length / itemsPerPage);
  const paginatedVisits = filteredVisits.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Always reset to first page when filtering
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 md:mb-8">
        <div>
          <h2 className="text-xl md:text-2xl font-bold font-heading">Agenda de Visitas</h2>
          <p className="text-slate-500 text-xs md:text-sm">Acompanhe e registre visitas programadas.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" placeholder="Filtrar por nome ou apt..." 
              value={filter} onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          <button 
            onClick={() => setShowAdd(true)}
            className="w-full sm:w-auto bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
          >
            <Calendar size={18} />
            Agendar Novo
          </button>
        </div>
      </header>

      <div className="space-y-4">
        {/* Mobile View: Cards */}
        <div className="grid grid-cols-1 gap-4 md:hidden">
          {paginatedVisits.length > 0 ? paginatedVisits.map(visit => (
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              key={visit.id} 
              className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 font-bold">
                    {visit.apartmentId}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{visit.visitorName}</p>
                    <p className="text-xs text-slate-500">{format(new Date(visit.scheduledAt), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                </div>
                <div className="text-right">
                   <span className={cn(
                    "text-[10px] font-bold uppercase px-2 py-1 rounded-full flex items-center gap-1",
                    visit.status === 'Scheduled' ? "bg-orange-50 text-orange-600" : visit.status === 'Completed' ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                  )}>
                    {visit.status === 'Scheduled' ? 'Agendado' : visit.status === 'Completed' ? 'Concluído' : 'Cancelado'}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                <span className={cn(
                  "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                  visit.visitorType === 'Resident' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-purple-50 text-purple-600 border-purple-100"
                )}>
                  {visit.visitorType === 'Resident' ? 'Morador' : 'Empresa'}
                </span>
                
                {visit.status === 'Scheduled' && isAdmin && (
                  <div className="flex gap-4">
                    <button 
                      onClick={() => updateVisitStatus(visit.id, 'Completed')}
                      className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700"
                    >
                      <CheckCircle2 size={16} />
                      Concluir
                    </button>
                    <button 
                      onClick={() => updateVisitStatus(visit.id, 'Cancelled')}
                      className="flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600"
                    >
                      <XCircle size={16} />
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )) : (
            <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 text-sm">
              Nenhuma visita encontrada.
            </div>
          )}
        </div>

        {/* Desktop View: Table */}
        <div className="hidden md:block bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden text-center">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Apt</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Visitante</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Data/Hora</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Tipo</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginatedVisits.length > 0 ? paginatedVisits.map(visit => (
                  <motion.tr 
                    layout
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    key={visit.id} 
                    className="hover:bg-slate-50/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <span className="font-bold text-blue-600">{visit.apartmentId}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-slate-800">{visit.visitorName}</p>
                      <p className="text-xs text-slate-400">{visit.notes || 'Sem observações'}</p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <p className="text-sm text-slate-600">{format(new Date(visit.scheduledAt), 'dd/MM/yyyy HH:mm')}</p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border inline-block",
                        visit.visitorType === 'Resident' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-purple-50 text-purple-600 border-purple-100"
                      )}>
                        {visit.visitorType === 'Resident' ? 'Morador' : 'Empresa'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center justify-center w-fit mx-auto gap-1",
                        visit.status === 'Scheduled' ? "text-orange-600" : visit.status === 'Completed' ? "text-emerald-600" : "text-slate-400"
                      )}>
                        <div className={cn("w-1.5 h-1.5 rounded-full", visit.status === 'Scheduled' ? "bg-orange-500 animate-pulse" : visit.status === 'Completed' ? "bg-emerald-500" : "bg-slate-400")} />
                        {visit.status === 'Scheduled' ? 'Agendado' : visit.status === 'Completed' ? 'Concluído' : 'Cancelado'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {visit.status === 'Scheduled' && isAdmin && (
                        <div className="flex justify-end gap-2 text-slate-400">
                          <button 
                            title="Concluir" 
                            onClick={() => updateVisitStatus(visit.id, 'Completed')}
                            className="hover:text-emerald-600 transition-colors p-1"
                          >
                            <CheckCircle2 size={18} />
                          </button>
                          <button 
                            title="Cancelar" 
                            onClick={() => updateVisitStatus(visit.id, 'Cancelled')}
                            className="hover:text-red-500 transition-colors p-1"
                          >
                            <XCircle size={18} />
                          </button>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">Nenhuma visita encontrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-6 border-t border-slate-100">
            <p className="text-sm text-slate-500">
              Mostrando <span className="font-bold text-slate-800">{paginatedVisits.length}</span> de <span className="font-bold text-slate-800">{filteredVisits.length}</span> visitas
            </p>
            <div className="flex gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="hidden sm:flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      "w-10 h-10 rounded-xl text-sm font-bold transition-all",
                      currentPage === page ? "bg-blue-600 text-white shadow-lg shadow-blue-100" : "text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setShowAdd(false)}
          >
            <motion.div 
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white rounded-t-[2.5rem] sm:rounded-3xl w-full max-w-md p-6 sm:p-8 shadow-2xl relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-slate-100 rounded-full sm:hidden" />
              <div className="mb-6">
                <h3 className="text-xl sm:text-2xl font-bold font-heading">Novo Agendamento</h3>
                <p className="text-slate-500 text-xs">Preencha os dados do visitante para registrar na agenda.</p>
              </div>
              
              <VisitForm config={config} onSuccess={() => setShowAdd(false)} onCancel={() => setShowAdd(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function updateVisitStatus(id: string, status: VisitStatus) {
  setDoc(doc(db, 'visits', id), { status }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.UPDATE, 'visits/' + id));
}

function VisitForm({ config, onSuccess, onCancel }: { config: BuildingConfig | null, onSuccess: () => void, onCancel: () => void }) {
  const [aptId, setAptId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<VisitorType>('Resident');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aptId || !name || !date) return;

    setLoading(true);
    try {
      await addDoc(collection(db, 'visits'), {
        apartmentId: aptId,
        visitorName: name,
        visitorType: type,
        scheduledAt: new Date(date).toISOString(),
        status: 'Scheduled',
        notes: notes || null
      });
      onSuccess();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'visits');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 md:space-y-2">
          <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Apartamento</label>
          <input 
            type="text" required placeholder="Apt" 
            value={aptId} onChange={e => setAptId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none bg-slate-50/50" 
          />
        </div>
        <div className="space-y-1.5 md:space-y-2">
          <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Data e Hora</label>
          <input 
            type="datetime-local" required 
            value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none bg-slate-50/50" 
          />
        </div>
      </div>

      <div className="space-y-1.5 md:space-y-2">
        <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Nome do Visitante</label>
        <input 
          type="text" required placeholder="Pessoa ou Empresa" 
          value={name} onChange={e => setName(e.target.value)}
          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none bg-slate-50/50" 
        />
      </div>

      <div className="space-y-1.5 md:space-y-2">
        <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo</label>
        <div className="grid grid-cols-2 gap-2">
          <button 
            type="button" onClick={() => setType('Resident')}
            className={cn(
              "py-2.5 sm:py-3 rounded-xl border font-bold text-xs sm:text-sm transition-all",
              type === 'Resident' ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100" : "border-slate-100 text-slate-400 hover:bg-slate-50 bg-white"
            )}
          >
            Morador
          </button>
          <button 
            type="button" onClick={() => setType('Renovation Company')}
            className={cn(
              "py-2.5 sm:py-3 rounded-xl border font-bold text-xs sm:text-sm transition-all",
              type === 'Renovation Company' ? "bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-100" : "border-slate-100 text-slate-400 hover:bg-slate-50 bg-white"
            )}
          >
            Empresa
          </button>
        </div>
      </div>

      <div className="space-y-1.5 md:space-y-2">
        <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Notas</label>
        <textarea 
          placeholder="Ex: Entrega de materiais, pintura..." 
          value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full border border-slate-200 rounded-xl p-3 text-sm h-20 resize-none focus:ring-2 focus:ring-blue-500 transition-all outline-none bg-slate-50/50" 
        />
      </div>

      <div className="pt-4 flex gap-3">
        <button 
          type="button" onClick={onCancel}
          className="flex-1 text-slate-400 font-bold hover:text-slate-600"
        >
          Cancelar
        </button>
        <button 
          type="submit" disabled={loading}
          className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
        >
          {loading ? 'Salvando...' : 'Agendar'}
        </button>
      </div>
    </form>
  );
}

function HistoryView({ logs }: { logs: KeyLog[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <header className="mb-4 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold font-heading">Histórico Recente</h2>
        <p className="text-slate-500 text-xs md:text-sm">Últimas 10 movimentações registradas.</p>
      </header>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="space-y-0 divide-y divide-slate-50">
          {logs.map(log => (
            <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-4 py-5 sm:px-6 hover:bg-slate-50/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0",
                  log.type === 'Checkout' ? "bg-orange-100 text-orange-600" : "bg-emerald-100 text-emerald-600"
                )}>
                  {log.type === 'Checkout' ? <LogOut size={20} /> : <LogIn size={20} />}
                </div>
                <div className="sm:hidden flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-blue-600">Apt {log.apartmentId}</span>
                    <p className="text-[10px] font-bold text-slate-400">{format(new Date(log.timestamp), 'HH:mm dd/MM')}</p>
                  </div>
                  <p className="text-sm font-bold text-slate-800 line-clamp-1">{log.holder}</p>
                </div>
              </div>
              
              <div className="hidden sm:flex flex-1 min-w-0 items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-blue-600">Apt {log.apartmentId}</span>
                  <ChevronRight size={14} className="text-slate-300" />
                  <span className="text-sm font-bold text-slate-800 truncate">{log.holder}</span>
                </div>
                <span className={cn(
                  "text-[10px] font-bold uppercase px-2 py-0.5 rounded-md",
                  log.holderType === 'Resident' ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                )}>
                  {log.holderType === 'Resident' ? 'Morador' : 'Empresa'}
                </span>
              </div>

              <div className="hidden sm:block text-right whitespace-nowrap">
                <p className="text-sm font-medium text-slate-700">{format(new Date(log.timestamp), 'HH:mm')}</p>
                <p className="text-xs text-slate-400">{format(new Date(log.timestamp), 'dd/MM/yyyy')}</p>
              </div>

              <div className="sm:hidden flex items-center justify-between pt-2 border-t border-slate-50 mt-1">
                <span className={cn(
                  "text-[9px] font-bold uppercase px-2 py-0.5 rounded-md",
                  log.holderType === 'Resident' ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                )}>
                  {log.holderType === 'Resident' ? 'Morador' : 'Empresa'}
                </span>
                <span className={cn(
                  "text-[9px] font-bold uppercase",
                  log.type === 'Checkout' ? "text-orange-600" : "text-emerald-600"
                )}>
                  {log.type === 'Checkout' ? 'Retirada realizada' : 'Devolução concluída'}
                </span>
              </div>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="p-20 text-center text-slate-400">Nenhum registro encontrado no histórico.</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ReportsView() {
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reportData, setReportData] = useState<KeyLog[]>([]);
  const [loading, setLoading] = useState(false);

  const generateReport = async () => {
    setLoading(true);
    try {
      const start = new Date(startDate + 'T00:00:00').toISOString();
      const end = new Date(endDate + 'T23:59:59').toISOString();
      
      const q = query(
        collection(db, 'keyLogs'),
        orderBy('timestamp', 'desc')
      );

      const snapshot = await getDocs(q);
      const allLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KeyLog));
      
      const filtered = allLogs.filter(log => log.timestamp >= start && log.timestamp <= end);
      setReportData(filtered);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'keyLogs');
    } finally {
      setLoading(false);
    }
  };

  const checkouts = reportData.filter(l => l.type === 'Checkout').length;
  const checkins = reportData.filter(l => l.type === 'Checkin').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <header className="mb-4 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold font-heading">Relatórios por Data</h2>
        <p className="text-slate-500 text-xs md:text-sm">Selecione o período para extrair os dados de movimentação.</p>
      </header>

      <div className="bg-white rounded-[2rem] md:rounded-3xl p-5 md:p-6 border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-end">
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-1 md:gap-4">
          <div className="space-y-1.5 min-w-0 w-full">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Data Inicial</label>
            <input 
              type="date" 
              value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-2.5 md:p-3 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
          <div className="space-y-1.5 min-w-0 w-full">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Data Final</label>
            <input 
              type="date" 
              value={endDate} onChange={e => setEndDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-2.5 md:p-3 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
        </div>
        <button 
          onClick={generateReport}
          disabled={loading}
          className="w-full md:w-auto bg-blue-600 text-white px-8 py-3 md:py-3.5 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
        >
          {loading ? 'Consultando...' : 'Consultar'}
        </button>
      </div>

      {reportData.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:gap-4">
             <div className="bg-orange-50 border border-orange-100 p-4 md:p-5 rounded-2xl">
                <p className="text-[10px] text-orange-600 font-bold uppercase mb-1">Total Saídas</p>
                <p className="text-xl md:text-2xl font-bold font-heading text-orange-950">{checkouts}</p>
             </div>
             <div className="bg-emerald-50 border border-emerald-100 p-4 md:p-5 rounded-2xl">
                <p className="text-[10px] text-emerald-600 font-bold uppercase mb-1">Total Entradas</p>
                <p className="text-xl md:text-2xl font-bold font-heading text-emerald-950">{checkins}</p>
             </div>
          </div>

          <div className="hidden md:block bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Momento</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Apt</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ação</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Responsável</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Vínculo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {reportData.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-600 tabular-nums">
                        {format(new Date(log.timestamp), 'dd/MM/yy HH:mm')}
                      </td>
                      <td className="px-6 py-4 font-bold text-blue-600">
                        {log.apartmentId}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded-md",
                          log.type === 'Checkout' ? "bg-orange-100 text-orange-600" : "bg-emerald-100 text-emerald-600"
                        )}>
                          {log.type === 'Checkout' ? 'Saída' : 'Entrada'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-700">
                        {log.holder}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "text-[10px] font-bold uppercase px-2 py-0.5 rounded-md",
                          log.holderType === 'Resident' ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                        )}>
                          {log.holderType === 'Resident' ? 'Morador' : 'Empresa'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cards for Mobile */}
          <div className="md:hidden space-y-3">
            {reportData.map(log => (
              <div key={log.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-blue-600">Apt {log.apartmentId}</span>
                  <span className={cn(
                    "text-[10px] font-black uppercase px-2 py-0.5 rounded-md",
                    log.type === 'Checkout' ? "bg-orange-100 text-orange-600" : "bg-emerald-100 text-emerald-600"
                  )}>
                    {log.type === 'Checkout' ? 'Saída' : 'Entrada'}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{log.holder}</p>
                    <p className="text-xs text-slate-400 capitalize">{log.holderType === 'Resident' ? 'Morador' : 'Empresa'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-600">{format(new Date(log.timestamp), 'HH:mm')}</p>
                    <p className="text-[10px] text-slate-400">{format(new Date(log.timestamp), 'dd/MM/yyyy')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="flex justify-center md:justify-end print:hidden">
            <button 
              onClick={() => window.print()}
              className="w-full md:w-auto flex items-center justify-center gap-2 text-slate-500 hover:text-slate-800 transition-colors py-3 px-6 border border-slate-200 rounded-xl bg-white shadow-sm font-bold text-sm"
            >
              <History size={18} />
              Imprimir Relatório
            </button>
          </div>
        </div>
      )}

      {reportData.length === 0 && !loading && (
        <div className="bg-white p-20 rounded-3xl border border-slate-100 text-center space-y-4">
          <Filter className="mx-auto text-slate-200" size={48} />
          <p className="text-slate-400 text-sm">Selecione datas e clique em consultar para ver os resultados.</p>
        </div>
      )}
    </motion.div>
  );
}

