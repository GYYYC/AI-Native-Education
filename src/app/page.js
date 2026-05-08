'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '登录失败'); return; }
      
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('token', data.token);

      if (data.user.role === 'boss') router.push('/boss');
      else router.push('/teacher');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (u, p) => { setUsername(u); setPassword(p); };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="icon">
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
            </svg>
          </div>
          <h1>A机构教育系统</h1>
          <p>智能教育管理 · AI 学情分析</p>
        </div>

        {error && <div className="error-msg">⚠️ {error}</div>}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">用户名</label>
            <input
              className="form-input"
              type="text"
              placeholder="请输入用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">密码</label>
            <input
              className="form-input"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{width: '100%', justifyContent: 'center', marginTop: 8}} disabled={loading}>
            {loading ? <span className="loading-spinner"></span> : '🔑 登录'}
          </button>
        </form>

        <hr className="divider" />
        
        <div>
          <div style={{fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, textAlign: 'center'}}>快速登录（演示账号）</div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
            <button className="btn btn-secondary" style={{width: '100%', justifyContent: 'center'}} onClick={() => quickLogin('boss', 'boss123')}>
              👑 管理员 (boss / boss123)
            </button>
            <button className="btn btn-secondary" style={{width: '100%', justifyContent: 'center'}} onClick={() => quickLogin('teacher1', 'teacher123')}>
              📚 张老师 · 数学 (teacher1)
            </button>
            <button className="btn btn-secondary" style={{width: '100%', justifyContent: 'center'}} onClick={() => quickLogin('teacher2', 'teacher123')}>
              📝 李老师 · 语文 (teacher2)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
