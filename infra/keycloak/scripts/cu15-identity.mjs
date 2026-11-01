export const coordinatorClientId = 'autonexus-cu15-coordinator';
export const coordinatorOwner = 'cu15-confirmation';
export const technicalScopes = [
  'cu15.staffing.read', 'cu15.staffing.reserve', 'cu15.staffing.confirm', 'cu15.staffing.release',
  'cu15.finance.read', 'cu15.finance.authorize', 'cu15.finance.cancel',
];
export const participantAudiences = ['autonexus-employees-api', 'autonexus-finance-api'];
/** Audiences every shell access token carries: the interactive surface of all owner services. */
export const apiAudiences = ['autonexus-operations-api', 'autonexus-employees-api', 'autonexus-finance-api', 'autonexus-intelligence-api'];
export const interactiveClients = ['autonexus-shell', 'autonexus-mf-employees', 'autonexus-mf-operations', 'autonexus-mf-finance', 'autonexus-mf-intelligence'];
