import React, { useState, useEffect } from 'react';
import { Shield, Activity, Users, Map, Globe, Server, Clock, RefreshCw } from 'lucide-react';

export default function Admin() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const totalVisitors = stats ? Object.keys(stats).length : 0;
  const totalRequests = stats ? Object.values(stats).reduce((acc: number, curr: any) => acc + curr.visitCount, 0) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        <header className="flex items-center justify-between pb-6 border-b border-white/10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-white">Security & Traffic Dashboard</h1>
              <p className="text-sm font-mono text-zinc-400">/admin/stats - Server Monitoring</p>
            </div>
          </div>
          <button 
            onClick={fetchStats}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </header>

        <main className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="bg-zinc-900 border border-indigo-500/20 p-6 rounded-2xl relative overflow-hidden group">
                <Users className="absolute -right-4 -top-4 w-24 h-24 text-indigo-500/10 group-hover:scale-110 transition-transform" />
                <h3 className="text-xs font-bold text-indigo-400 mb-2 uppercase tracking-widest relative z-10">Total Visitors (IPs)</h3>
                <div className="text-4xl font-black text-white relative z-10">{totalVisitors}</div>
             </div>
             <div className="bg-zinc-900 border border-emerald-500/20 p-6 rounded-2xl relative overflow-hidden group">
                <Activity className="absolute -right-4 -top-4 w-24 h-24 text-emerald-500/10 group-hover:scale-110 transition-transform" />
                <h3 className="text-xs font-bold text-emerald-400 mb-2 uppercase tracking-widest relative z-10">Total API Requests</h3>
                <div className="text-4xl font-black text-white relative z-10">{totalRequests}</div>
             </div>
             <div className="bg-zinc-900 border border-fuchsia-500/20 p-6 rounded-2xl relative overflow-hidden group">
                <Server className="absolute -right-4 -top-4 w-24 h-24 text-fuchsia-500/10 group-hover:scale-110 transition-transform" />
                <h3 className="text-xs font-bold text-fuchsia-400 mb-2 uppercase tracking-widest relative z-10">Rate Limit Strategy</h3>
                <div className="text-xl font-black text-white relative z-10">100 / IP</div>
                <div className="text-[10px] text-zinc-500 uppercase mt-1 relative z-10">Hard limit per visitor</div>
             </div>
          </div>

          <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 bg-zinc-900/50 flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400"/> Live Traffic Log
              </h3>
            </div>
            <div className="overflow-x-auto">
              {stats && Object.keys(stats).length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/20 text-[10px] uppercase font-black tracking-widest text-zinc-500 border-b border-white/5">
                      <th className="p-4 whitespace-nowrap">IP Address</th>
                      <th className="p-4 whitespace-nowrap">L. Visit</th>
                      <th className="p-4 whitespace-nowrap">Req Count</th>
                      <th className="p-4 whitespace-nowrap hidden md:table-cell">Regions Searched</th>
                      <th className="p-4 whitespace-nowrap hidden lg:table-cell">User Agent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-zinc-300">
                    {Object.values(stats).sort((a: any, b: any) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime()).map((v: any, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                         <td className="p-4 font-mono text-indigo-300">{v.ip}</td>
                         <td className="p-4 font-mono text-[10px]">
                           <div className="flex items-center gap-1"><Clock className="w-3 h-3 text-zinc-500"/>{new Date(v.lastVisit).toLocaleTimeString()}</div>
                         </td>
                         <td className="p-4">
                            <span className={`px-2 py-1 rounded font-bold text-[10px] ${v.visitCount > 80 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : v.visitCount > 30 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                               {v.visitCount}
                            </span>
                         </td>
                         <td className="p-4 hidden md:table-cell">
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {Object.entries(v.regionsViewed).map(([reg, count]: any) => (
                                 <span key={reg} className="bg-white/10 px-2 py-0.5 rounded text-[9px] border border-white/5">
                                   {reg} <b>({count})</b>
                                 </span>
                              ))}
                            </div>
                         </td>
                         <td className="p-4 font-mono text-[9px] text-zinc-500 hidden lg:table-cell max-w-xs truncate" title={v.userAgent}>
                           {v.userAgent}
                         </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 flex flex-col items-center justify-center text-zinc-600">
                  <Map className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-sm font-bold uppercase tracking-widest">No traffic data yet</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
