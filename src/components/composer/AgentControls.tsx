import { Check, GitBranch, Sparkles, X } from 'lucide-react';
import { SKILLS, WORKFLOWS, skillById, workflowById } from '../../engine/skills';
import { setComposer, useStore } from '../../store/store';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Chip, Segmented } from '../ui/primitives';

function SkillsChip() {
  const skillId = useStore((s) => s.composer.skillId);
  const pop = usePopover();
  const skill = skillById(skillId);
  return (
    <>
      <Chip ref={pop.ref} icon={Sparkles} active={pop.open || Boolean(skill)} onClick={pop.toggle} data-tip="Skills shape how the agent writes prompts">
        {skill ? skill.name : 'Skills'}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={340} label="Skills" className="pop-scroll">
        <PopoverHeader title="Skills" sub="Expert know-how the agent applies to your request." />
        <div className="pick-list">
          {SKILLS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`pick-row ${s.id === skillId ? 'is-active' : ''}`}
              onClick={() => {
                setComposer({ skillId: s.id === skillId ? null : s.id });
                pop.close();
              }}
            >
              <span className="pick-text">
                <span className="pick-name">{s.name}</span>
                <span className="pick-desc">{s.description}</span>
              </span>
              {s.id === skillId ? <Check size={14} className="pick-check" /> : null}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function WorkflowsChip() {
  const workflowId = useStore((s) => s.composer.workflowId);
  const workspace = useStore((s) => s.ui.workspace);
  const pop = usePopover();
  const wf = workflowById(workflowId);
  const available = WORKFLOWS.filter((w) => w.workspaces.includes(workspace));
  const unavailable = WORKFLOWS.filter((w) => !w.workspaces.includes(workspace));
  return (
    <>
      <Chip ref={pop.ref} icon={GitBranch} active={pop.open || Boolean(wf)} onClick={pop.toggle} data-tip="Workflows give the agent a proven step structure">
        {wf ? wf.name : 'Workflows'}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={360} label="Workflows" className="pop-scroll">
        <PopoverHeader title="Workflows" sub="Multi-step recipes. The agent adapts the prompts to your request." />
        <div className="pick-list">
          {available.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`pick-row ${w.id === workflowId ? 'is-active' : ''}`}
              onClick={() => {
                setComposer({ workflowId: w.id === workflowId ? null : w.id });
                pop.close();
              }}
            >
              <span className="pick-text">
                <span className="pick-name">{w.name}</span>
                <span className="pick-desc">{w.description}</span>
                <span className="pick-steps">
                  {w.steps.map((s) => (
                    <span key={s.id} className={`step-dot k-${s.kind === 'op' ? 'tool' : s.kind}`} data-tip={s.title} />
                  ))}
                </span>
              </span>
              {w.id === workflowId ? <Check size={14} className="pick-check" /> : null}
            </button>
          ))}
          {unavailable.length ? <div className="menu-sep-label">Other workspaces</div> : null}
          {unavailable.map((w) => (
            <div key={w.id} className="pick-row is-disabled" data-tip={`Available in ${w.workspaces.join(', ')}`}>
              <span className="pick-text">
                <span className="pick-name">{w.name}</span>
                <span className="pick-desc">{w.description}</span>
              </span>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function AgentControls() {
  const style = useStore((s) => s.composer.agentStyle);
  const workflowId = useStore((s) => s.composer.workflowId);
  const workspace = useStore((s) => s.ui.workspace);
  const wf = workflowById(workflowId);
  return (
    <>
      <Segmented
        value={style}
        size="sm"
        onChange={(v) => setComposer({ agentStyle: v })}
        options={[
          { value: 'auto', label: 'Auto', tip: 'One shot: the agent decides and only stops to confirm the cost' },
          { value: 'guided', label: 'Guided', tip: 'The agent asks a few questions (max rounds in Settings), then shows the plan' },
        ]}
      />
      <SkillsChip />
      <WorkflowsChip />
      {wf && !wf.workspaces.includes(workspace) ? (
        <Chip icon={X} muted onClick={() => setComposer({ workflowId: null })} data-tip="This workflow does not apply here; it will be ignored">
          Not for {workspace}
        </Chip>
      ) : null}
    </>
  );
}
