import { Grip, Monitor, X } from 'lucide-react'

export function DesktopPermissionGuide(): React.JSX.Element {
  return <div className="permission-floating-guide">
    <div className="permission-floating-heading">开启 Pi Desktop 权限<button aria-label="关闭提示" onClick={() => window.pi.desktopPermissionGuideClose()}><X size={16} /></button></div>
    <div className="desktop-permission-drag" draggable data-desktop-permission-drag onDragStart={(event) => { event.preventDefault(); window.pi.desktopPermissionDragApp() }}>
      <Monitor size={24} /><span><strong>按住拖到系统设置的应用列表</strong><small>松开后开启开关；也可点击列表下方的「＋」添加。</small></span><Grip size={18} />
    </div>
  </div>
}
