
import React from "react";
import Link from "next/link";

interface EmptyStateAction {
  label:   string;
  href?:   string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon:        string;
  title:       string;
  description: string;
  action?:     EmptyStateAction;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="card text-center py-16 animate-fade-in" role="status">
      <div
        className="text-5xl mb-4 mx-auto flex items-center justify-center"
        aria-hidden="true"
        style={{ height: 64 }}
      >
        {icon}
      </div>
      <h2 className="font-display text-2xl text-cream mb-2">{title}</h2>
      <p className="text-stone-400 text-sm mb-6" style={{ maxWidth: 360, margin: "0 auto 1.5rem" }}>
        {description}
      </p>
      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="btn-primary inline-flex"
            aria-label={action.label}
          >
            {action.label}
          </Link>
        ) : (
          <button
            className="btn-primary"
            onClick={action.onClick}
            aria-label={action.label}
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
