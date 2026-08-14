import { NavLink } from 'react-router-dom';
import { FileInput, FolderClock } from 'lucide-react';

const adminDestinations = [
  {
    to: '/admin/draft-recovery',
    label: 'Draft Recovery',
    icon: FolderClock
  },
  {
    to: '/admin/submit-intake',
    label: 'Submit Intake',
    icon: FileInput
  }
];

export default function AdminWorkspaceNav() {
  return (
    <nav className="brand-admin-nav" aria-label="Admin workspace">
      {adminDestinations.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `brand-admin-nav__link${isActive ? ' brand-admin-nav__link--active' : ''}`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
