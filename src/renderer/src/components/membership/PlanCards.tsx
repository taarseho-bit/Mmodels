export interface MembershipPlan {
  id: 'trial' | 'lifetime' | 'monthly';
  title: string;
  price: string;
  period: string;
  days: number;
  features: string[];
  featured?: boolean;
  badge?: string;
}

export const MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    id: 'trial',
    title: '7 天冲刺卡',
    price: '¥9.9',
    period: '7 天',
    days: 7,
    features: ['卡密激活后立即生效', '对话积分不限量', '多智能体协作与工作流'],
  },
  {
    id: 'lifetime',
    title: '长期卡 · 3650 天',
    price: '¥99',
    period: '3650 天',
    days: 3650,
    badge: '早期长期权益',
    featured: true,
    features: ['卡密激活后长期可用', '全部高级建模能力', '已有长期卡继续有效'],
  },
  {
    id: 'monthly',
    title: '30 天备赛卡',
    price: '¥29',
    period: '30 天',
    days: 30,
    features: ['适合一次比赛周期', '对话积分不限量', '高级图表与成品导出'],
  },
];

export function PlanCards({
  selected,
  onSelect,
}: {
  selected?: MembershipPlan['id'];
  onSelect?: (plan: MembershipPlan) => void;
}): JSX.Element {
  return (
    <div className="membership-plans" aria-label="会员套餐">
      {MEMBERSHIP_PLANS.map((plan) => (
        <button
          type="button"
          key={plan.id}
          className={`membership-plan-card${plan.featured ? ' featured' : ''}${selected === plan.id ? ' selected' : ''}`}
          aria-pressed={selected === plan.id}
          onClick={() => onSelect?.(plan)}
        >
          {plan.badge && <span className="membership-plan-badge">{plan.badge}</span>}
          <h3>{plan.title}</h3>
          <div className="membership-plan-price">{plan.price}<small>{plan.period}</small></div>
          <ul className="membership-plan-list">
            {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
          <span className="membership-plan-hint">选择后输入卡密激活</span>
        </button>
      ))}
    </div>
  );
}
