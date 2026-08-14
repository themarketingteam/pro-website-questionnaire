import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ExternalLink, FileInput, FolderClock } from 'lucide-react';

const EXPRESS_RECOVERY_URL = 'https://expressform.tmtwebsiteresources.xyz/admin/draft-recovery';

export default function AdminWorkspaceNav() {
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const navRef = useRef(null);
  const isSubmitIntake = pathname === '/admin/submit-intake';
  const internalDestination = isSubmitIntake
    ? {
        to: '/admin/draft-recovery',
        label: 'Draft Recovery',
        icon: FolderClock,
      }
    : {
        to: '/admin/submit-intake',
        label: 'Submit Intake (JSON)',
        icon: FileInput,
      };
  const InternalIcon = internalDestination.icon;

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const closeOutsideMenu = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) setIsOpen(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutsideMenu);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutsideMenu);
    };
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className={`brand-admin-nav${isOpen ? ' brand-admin-nav--open' : ''}`}
      aria-label="Admin workspace"
    >
      <button
        type="button"
        className="brand-admin-nav__trigger"
        aria-label={isOpen ? 'Close admin navigation' : 'Open admin navigation'}
        aria-expanded={isOpen}
        aria-controls="admin-workspace-menu"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="brand-admin-nav__line" aria-hidden="true" />
        <span className="brand-admin-nav__line" aria-hidden="true" />
        <span className="brand-admin-nav__line" aria-hidden="true" />
      </button>

      <div id="admin-workspace-menu" className="brand-admin-nav__links">
        <a
          href={EXPRESS_RECOVERY_URL}
          className="brand-admin-nav__link"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setIsOpen(false)}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Express Form Recovery
        </a>
        <NavLink
          to={internalDestination.to}
          className="brand-admin-nav__link"
          onClick={() => setIsOpen(false)}
        >
          <InternalIcon className="h-4 w-4" aria-hidden="true" />
          {internalDestination.label}
        </NavLink>
      </div>
    </nav>
  );
}
