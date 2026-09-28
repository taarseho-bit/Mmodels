export interface MembershipPlan {
  id: 'trial' | 'lifetime' | 'monthly';
  title: string;
  price: string;
  period: string;
  features: string[];
  featured?: boolean;
  badge?: string;
}

export const MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    id: 'trial',
    title: '体验卡',
    price: '¥9.9',
    period: '7 天',
    features: ['全功能试用', '不限 AI 次数', '多智能体协作'],
  },
  {
    id: 'lifetime',
    title: '长期卡',
    price: '¥99',
    period: '3650 天',
    badge: '最受欢迎',
    featured: true,
    features: ['全部高级 AI 能力', '长期使用 · 3650 天', '未来新功能优先使用'],
  },
  {
    id: 'monthly',
    title: '月卡',
    price: '¥29',
    period: '30 天',
    features: ['适合备赛周期', '不限 AI 次数', '高级图表与导出'],
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
          <span className="membership-plan-hint">购卡后获得卡密</span>
        </button>
      ))}
    </div>
  );
}
