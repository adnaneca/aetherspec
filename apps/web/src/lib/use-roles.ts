import { useKeycloak } from './keycloak';

export function useRoles() {
  const { user } = useKeycloak();
  const roles = user?.roles || [];

  return {
    roles,
    hasRole: (role: string) => roles.includes(role),
    isAdmin: roles.includes('ROLE_REALM_ADMIN'),
    canApproveBRS: roles.includes('BRS_APPROVER') || roles.includes('ROLE_BA_LEAD') || roles.includes('ROLE_REALM_ADMIN'),
    canApproveSRS: roles.includes('SRS_APPROVER') || roles.includes('ROLE_SOLUTION_ARCHITECT') || roles.includes('ROLE_REALM_ADMIN'),
    canApproveTestCase: roles.includes('TESTCASE_APPROVER') || roles.includes('ROLE_QA_LEAD') || roles.includes('ROLE_REALM_ADMIN'),
    canApproveDoc: (docType: string) => {
      if (docType === 'brs') return roles.includes('BRS_APPROVER') || roles.includes('ROLE_BA_LEAD') || roles.includes('ROLE_REALM_ADMIN');
      if (docType === 'srs') return roles.includes('SRS_APPROVER') || roles.includes('ROLE_SOLUTION_ARCHITECT') || roles.includes('ROLE_REALM_ADMIN');
      if (docType === 'testcase') return roles.includes('TESTCASE_APPROVER') || roles.includes('ROLE_QA_LEAD') || roles.includes('ROLE_REALM_ADMIN');
      return false;
    },
    canMergeBRS: roles.includes('ROLE_BA_LEAD') || roles.includes('ROLE_REALM_ADMIN'),
    canDeleteProject: roles.includes('ROLE_REALM_ADMIN'),
    canManageAdmin: roles.includes('ROLE_REALM_ADMIN'),
  };
}

// Human-readable role label for the user badge.
export function getRoleLabel(roles: string[]): string {
  if (roles.includes('ROLE_REALM_ADMIN')) return 'Admin';
  if (roles.includes('ROLE_BA_LEAD')) return 'BA Lead';
  if (roles.includes('ROLE_SOLUTION_ARCHITECT')) return 'Architect';
  if (roles.includes('ROLE_QA_LEAD')) return 'QA Lead';
  if (roles.includes('ROLE_MARKETING_HEAD')) return 'Marketing';
  if (roles.includes('ROLE_DEV_LEAD')) return 'Tech Lead';
  return 'User';
}
