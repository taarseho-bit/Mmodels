/** 画布里的轻量角色头像；不是额外模型或桌面宠物，不使用图片/逐帧脚本。 */
export function WorkflowAvatar({ role, working, returned }: { role: string; working: boolean; returned: boolean }): JSX.Element {
  const glasses = /data|review|general/.test(role);
  return <span className={`flow-person${working ? ' is-working' : ''}${returned ? ' is-returned' : ''}`} aria-hidden="true">
    <span className="flow-person-body" />
    <span className="flow-person-face"><span className="flow-person-hair" /><span className="flow-person-eyes"><i /><i /></span>
      {glasses && <span className="flow-person-glasses" />}<span className="flow-person-mouth" /></span>
    {working && <span className="flow-person-hand" />}
  </span>;
}
