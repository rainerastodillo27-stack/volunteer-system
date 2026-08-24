const { getProjectIdsForPartner, getProjectIdsForPartnerUser } = require('../utils/mapProjectLinks');

// Let's test the current implementation with the data from DB
const partners = [{
  id: 'partner-user-1787253077389',
  ownerUserId: 'user-1787253077389',
  name: 'TEST ORG',
  contactEmail: 'rainerastodillo3@gmail.com'
}];

const applications = [{
  id: 'partner-application-1787253752851',
  projectId: 'project-proposal-1787263009961',
  partnerUserId: 'user-1787253077389',
  partnerName: 'Rainer Astodillo',
  partnerEmail: 'rainerastodillo3@gmail.com',
  status: 'Approved',
  proposalDetails: {
    targetProjectId: 'TEST',
    requestedProgramModule: 'Disaster',
    proposedTitle: 'TEST PROPOSAL'
  }
}];

const projects = [
  {
    id: 'project-1782626625860',
    title: 'TEST',
    isEvent: false,
    parentProjectId: 'TEST',
    partnerId: '',
    location: { latitude: 9.7573, longitude: 123.1392, address: 'Bindoy' }
  },
  {
    id: 'project-proposal-1787263009961',
    title: 'TEST PROPOSAL',
    isEvent: false,
    parentProjectId: 'TEST',
    partnerId: 'partner-user-1787253077389',
    location: { latitude: 9.59, longitude: 123.12, address: 'City of Bais' }
  }
];

const ids = getProjectIdsForPartner(partners[0], projects, applications);
console.log('Project IDs for TEST ORG:', ids);
