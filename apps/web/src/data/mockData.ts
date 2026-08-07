import type { Persona, SDLCProject } from '../types';

export const INITIAL_PERSONAS: Persona[] = [
  {
    id: 'ba_lead',
    name: 'Elif Demir',
    title: 'Lead Business Analyst',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    keycloakRoles: ['ROLE_BA_LEAD', 'ROLE_ANALYST', 'BRS_APPROVER'],
    department: 'Business Analysis & Strategy',
  },
  {
    id: 'solution_architect',
    name: 'Ahmet Yilmaz',
    title: 'Principal Solution Architect',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    keycloakRoles: ['ROLE_SOLUTION_ARCHITECT', 'SRS_APPROVER', 'TECH_GOVERNANCE'],
    department: 'Software Architecture',
  },
  {
    id: 'marketing_manager',
    name: 'Zeynep Kaya',
    title: 'Marketing & Fleet Operations Director',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
    keycloakRoles: ['ROLE_MARKETING_HEAD', 'BRS_EXECUTIVE_APPROVER'],
    department: 'Marketing & Commercial Ops',
  },
  {
    id: 'tech_lead',
    name: 'Can Arslan',
    title: 'Senior Tech Lead / Lead Developer',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
    keycloakRoles: ['ROLE_DEV_LEAD', 'SRS_TECHNICAL_APPROVER'],
    department: 'Engineering',
  },
  {
    id: 'qa_lead',
    name: 'Selin Ozturk',
    title: 'QA & Test Engineering Lead',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    keycloakRoles: ['ROLE_QA_LEAD', 'TESTCASE_APPROVER'],
    department: 'Quality Assurance',
  },
  {
    id: 'admin',
    name: 'System Admin',
    title: 'Platform Administrator',
    avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
    keycloakRoles: ['ROLE_REALM_ADMIN', 'MODEL_ROUTER_ADMIN'],
    department: 'Platform Engineering',
  },
];

export const MOCK_PROJECTS: SDLCProject[] = [
  {
    id: 'prj-001',
    name: 'HedefFilo Fleet Telematics Portal',
    key: 'FLEET',
    description: 'AI-driven real-time vehicle telematics tracking, driver scoring, and automated maintenance scheduling system.',
    targetDate: '2026-11-30',
    status: 'Active',
    pipeline: {
      brs: { status: 'IN_PROGRESS', currentStep: 3, totalSteps: 11 },
      srs: { status: 'NOT_STARTED', currentStep: 1, totalSteps: 11 },
      testcase: { status: 'NOT_STARTED', currentStep: 1, totalSteps: 3 },
    },
  },
  {
    id: 'prj-002',
    name: 'Payment & Invoicing Gateway v2',
    key: 'PAYMENT',
    description: 'KVKK compliant PCI-DSS billing engine with automated credit risk checks and multi-bank integration.',
    targetDate: '2026-12-15',
    status: 'Active',
    pipeline: {
      brs: { status: 'SIGNED_OFF', currentStep: 11, totalSteps: 11 },
      srs: { status: 'IN_PROGRESS', currentStep: 4, totalSteps: 11 },
      testcase: { status: 'NOT_STARTED', currentStep: 1, totalSteps: 3 },
    },
  },
];
