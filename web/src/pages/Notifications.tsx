import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button, Card, Empty, Input } from '@/components/ui/primitives';

export function NotificationsPage() {
  const qc = useQueryClient();
  const [text, setText] = useState(''); const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const q = useQuery({ queryKey: ['notifications', search], queryFn: () => api.get<{ id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[]>(`/api/notifications${search ? `?search=${encodeURIComponent(search)}` : ''}`) });
  const read = useMutation({ mutationFn: (ids?: string[]) => api.post('/api/notifications/read', { ids }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['unread'] }); } });
  const digest = useMutation({ mutationFn: (enabled: boolean) => api.patch('/api/notifications/digest', { enabled }) });
  return <Card title="Notifications" actions={<><Button size="sm" variant="outline" onClick={() => read.mutate(undefined)}>Mark all read</Button><label className="flex items-center gap-1 text-xs"><input type="checkbox" defaultChecked onChange={(e) => digest.mutate(e.target.checked)} /> Daily email digest</label></>}>
    <Input type="search" className="mb-3" placeholder="Search the notifications: an item, a DR / form number, a name…" value={text} onChange={(e) => setText(e.target.value)} />
    {search && <p className="mb-2 text-xs text-slate-500">{q.data?.length ?? 0} notification{q.data?.length === 1 ? '' : 's'} match “{search}” (every word must appear).</p>}
    {!q.data?.length ? <Empty>{search ? 'No notification matches.' : undefined}</Empty> : <ul className="divide-y">{q.data.map((n) => <li key={n.id} className={`py-2 text-sm ${n.type === 'PROMO' ? 'rounded-xl border-l-4 border-rose-500 bg-amber-50 px-3 ' : ''}${n.readAt ? 'text-slate-500' : 'font-medium'}`}><div className="flex items-start justify-between gap-2"><div>{n.link ? <Link to={n.link} className="hover:underline" onClick={() => read.mutate([n.id])}>{n.title}</Link> : n.title}{n.body && <div className="text-xs font-normal text-slate-500">{n.body}</div>}</div><span className="whitespace-nowrap text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</span></div></li>)}</ul>}
  </Card>;
}
