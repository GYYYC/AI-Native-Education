'use client';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Sidebar({ user }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeUrl, setActiveUrl] = useState('');

  useEffect(() => {
    const updateUrl = () => {
      setActiveUrl(window.location.pathname + window.location.search + window.location.hash);
    };
    updateUrl();
    
    // Monkey-patch pushState and replaceState to catch Next.js shallow routing
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    window.history.pushState = function() {
      originalPushState.apply(this, arguments);
      setTimeout(updateUrl, 50);
    };
    window.history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      setTimeout(updateUrl, 50);
    };
    
    window.addEventListener('popstate', updateUrl);
    window.addEventListener('hashchange', updateUrl);
    
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', updateUrl);
      window.removeEventListener('hashchange', updateUrl);
    };
  }, [pathname]);

  const checkIsActive = (href) => {
    if (!activeUrl) {
       // SSR Initial exact match fallback
       return pathname === href.split('?')[0].split('#')[0] && !href.includes('?') && !href.includes('#');
    }

    // Teacher navigation logic
    if (activeUrl.startsWith('/teacher')) {
       if (activeUrl.startsWith('/teacher/student') && href.includes('tab=students')) return true;
       if (activeUrl.startsWith('/teacher/exam') && href.includes('tab=exams')) return true;
       
       const urlTab = new URLSearchParams(activeUrl.split('?')[1] || '').get('tab') || 'students';
       const hrefTab = new URLSearchParams(href.split('?')[1] || '').get('tab') || 'students';
       if (activeUrl.split('?')[0].split('#')[0] === '/teacher') {
         return urlTab === hrefTab && href.startsWith('/teacher');
       }
    }

    // Boss navigation logic
    if (activeUrl.startsWith('/boss')) {
       if (activeUrl.startsWith('/boss/student') && href === '/boss') return true;
       if (activeUrl.startsWith('/boss/generate') && href === '/boss/generate') return true;
       
       const urlPath = activeUrl.split('?')[0].split('#')[0];
       const hrefPath = href.split('?')[0].split('#')[0];
       // Exact path match for sub-pages like /boss/generate
       if (urlPath === hrefPath && urlPath !== '/boss') return true;

       const urlHash = activeUrl.split('#')[1] || '';
       const hrefHash = href.split('#')[1] || '';
       if (urlPath === '/boss') {
         return urlHash === hrefHash && href.startsWith('/boss') && !href.includes('/boss/');
       }
    }

    // Default exact match for standard links
    return activeUrl === href;
  };

  const logout = () => {
    localStorage.clear();
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    router.push('/');
  };

  const bossNav = [
    { href: '/boss', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>, label: '总览仪表盘' },
    { href: '/boss#teachers', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>, label: '教师班级概况' },
    { href: '/boss#alerts', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>, label: '异常告警' },
    { href: '/boss/generate', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>, label: '教学生成中心' },
    { href: '/rag', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, label: 'AI 知识库' },
  ];

  const teacherNav = [
    { href: '/teacher?tab=students', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>, label: '学生管理' },
    { href: '/teacher?tab=exams', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>, label: '考试管理' },
    { href: '/teacher?tab=alerts', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>, label: '异常告警' },
    { href: '/rag', icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, label: 'AI 知识库' },
  ];

  const nav = user?.role === 'boss' ? bossNav : teacherNav;

  const roleName = user?.role === 'boss' ? '管理员' : `教师 · ${user?.subject || ''}`;

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="url(#gradient)" strokeWidth={2}>
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--accent-indigo)" />
                <stop offset="100%" stopColor="var(--accent-cyan)" />
              </linearGradient>
            </defs>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          A机构系统
        </h1>
        <p>智能化教育管理平台</p>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">功能导航</div>
        {nav.map(item => (
          <button
            key={item.href}
            className={`nav-item ${checkIsActive(item.href) ? 'active' : ''}`}
            onClick={() => router.push(item.href)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <div className="user-badge">
            <div className="avatar">{user.name?.[0] || '?'}</div>
            <div className="user-info">
              <div className="user-name">{user.name}</div>
              <div className="user-role">{roleName}</div>
            </div>
            <button className="logout-btn" onClick={logout} title="退出登录">↩</button>
          </div>
        )}
      </div>
    </div>
  );
}
