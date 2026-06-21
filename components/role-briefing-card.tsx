type RoleBriefing = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

type RoleBriefingCardProps = {
  title: string;
  subtitle?: string;
  role: RoleBriefing;
};

export function RoleBriefingCard({
  title,
  subtitle,
  role,
}: RoleBriefingCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {subtitle ? (
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      ) : null}
      <div className="mt-4 space-y-4">
        <RoleSection
          title="Private instructions"
          content={role.privateInstructions}
        />
        {role.objectives ? (
          <RoleSection title="Objectives" content={role.objectives} />
        ) : null}
        {role.constraints ? (
          <RoleSection title="Constraints" content={role.constraints} />
        ) : null}
        {role.hiddenInfo ? (
          <RoleSection title="Hidden info" content={role.hiddenInfo} />
        ) : null}
        {role.fallbackPosition ? (
          <RoleSection title="Fallback position" content={role.fallbackPosition} />
        ) : null}
      </div>
    </div>
  );
}

function RoleSection({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-slate-900">{title}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {content}
      </p>
    </div>
  );
}

export type { RoleBriefing };
