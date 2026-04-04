import fs from 'fs';
import path from 'path';
import { config } from './config';
import {
  initPgDb,
  listDrawings,
  listProjects,
  listLocations,
  listGroups,
  createDrawing,
  createProject,
  createLocation,
  createGroup,
  addDrawingToProject,
  addDrawingToLocation,
  addGroupToProject,
  addUserToGroup,
  setDrawingFilePath,
} from './pgDb';

function buildTestPdf(title: string): Buffer {
  const content = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>/Contents 4 0 R>>endobj
4 0 obj<</Length 200>>
stream
BT
/F1 24 Tf
50 750 Td
(${title.replace(/[()\\]/g, ' ')}) Tj
0 -50 Td
/F1 14 Tf
(Drawing Specification) Tj
0 -30 Td
(PLM SharePoint - Test Document) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
trailer<</Size 5/Root 1 0 R>>
startxref
0
%%EOF`;
  return Buffer.from(content, 'utf8');
}

async function seed(): Promise<void> {
  await initPgDb();

  const uploadDir = path.resolve(config.uploadDir);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // --- Projects ---
  const existingProjects = await listProjects();
  const existingProjectNames = new Set(existingProjects.map((p) => p.name));

  const projectDefs = [
    { name: 'Dental Implants', description: 'Dental implant components and assemblies' },
    { name: 'Surgical Tools', description: 'Precision surgical instruments' },
    { name: 'Crown & Bridge', description: 'Restorative dentistry components' },
  ];

  const projectMap: Record<string, string> = {};
  for (const p of existingProjects) {
    projectMap[p.name] = p.id;
  }

  for (const def of projectDefs) {
    if (!existingProjectNames.has(def.name)) {
      const created = await createProject(def);
      projectMap[created.name] = created.id;
    }
  }

  // --- Locations ---
  const existingLocations = await listLocations();
  const existingLocationNames = new Set(existingLocations.map((l) => l.name));

  const locationDefs = [
    { name: 'Copenhagen Warehouse' },
    { name: 'Munich Design Center' },
    { name: 'Oslo R&D Lab' },
  ];

  const locationMap: Record<string, string> = {};
  for (const l of existingLocations) {
    locationMap[l.name] = l.id;
  }

  for (const def of locationDefs) {
    if (!existingLocationNames.has(def.name)) {
      const created = await createLocation(def);
      locationMap[created.name] = created.id;
    }
  }

  // --- Groups ---
  const existingGroups = await listGroups();
  const existingGroupNames = new Set(existingGroups.map((g) => g.name));

  const groupDefs = ['Engineers', 'Designers', 'Managers'];

  const groupMap: Record<string, string> = {};
  for (const g of existingGroups) {
    groupMap[g.name] = g.id;
  }

  for (const name of groupDefs) {
    if (!existingGroupNames.has(name)) {
      const created = await createGroup(name);
      groupMap[created.name] = created.id;
    }
  }

  // --- Drawings ---
  const drawingDefs = [
    {
      name: 'Titanium Scanning Body - Standard',
      description: 'Precision titanium scanning body for IOS systems, standard platform',
      revision: 'C',
      metadata: {
        author: 'Morten Falk Reventlow',
        version: '3.0',
        tags: ['titanium', 'scanning', 'implant'],
        material: 'Grade 5 Titanium',
        tolerance: '±0.005mm',
        standard: 'ISO 13485',
      },
      projects: ['Dental Implants'],
      locations: ['Copenhagen Warehouse', 'Munich Design Center'],
    },
    {
      name: 'Zirconia Crown Blank HT 98mm',
      description: 'High-translucency zirconia disk for CAD/CAM milling',
      revision: 'B',
      metadata: {
        author: 'Lars Nielsen',
        version: '2.1',
        tags: ['zirconia', 'crown', 'blank'],
        material: 'Zirconia HT',
        dimensions: '98mm disc',
        standard: 'ISO 6872',
      },
      projects: ['Crown & Bridge'],
      locations: ['Munich Design Center'],
    },
    {
      name: 'Healing Abutment - Regular Platform',
      description: 'Titanium healing abutment for soft tissue management',
      revision: 'B',
      metadata: {
        author: 'Morten Falk Reventlow',
        version: '2.0',
        tags: ['abutment', 'healing', 'titanium'],
        material: 'Grade 5 Titanium',
        platform: 'Regular',
        diameter: '4.8mm',
      },
      projects: ['Dental Implants'],
      locations: ['Copenhagen Warehouse'],
    },
    {
      name: 'Bone Spreader Osteotome Set',
      description: 'Surgical instrument set for flapless implant procedures',
      revision: 'A',
      metadata: {
        author: 'Anna Petersen',
        version: '1.0',
        tags: ['surgical', 'instrument', 'osteotome'],
        material: '316L Stainless Steel',
        sterilization: 'Autoclave 134°C',
        standard: 'ISO 17665',
      },
      projects: ['Surgical Tools'],
      locations: ['Oslo R&D Lab', 'Copenhagen Warehouse'],
    },
    {
      name: 'PEEK Temporary Crown - Universal',
      description: 'Biocompatible PEEK temporary crown for long-term provisionals',
      revision: 'C',
      metadata: {
        author: 'Lars Nielsen',
        version: '3.0',
        tags: ['PEEK', 'temporary', 'crown'],
        material: 'PEEK polymer',
        transparency: 'Translucent',
        biocompatibility: 'ISO 10993',
      },
      projects: ['Crown & Bridge', 'Dental Implants'],
      locations: ['Munich Design Center', 'Oslo R&D Lab'],
    },
  ];

  const existingDrawings = await listDrawings();
  const existingDrawingNames = new Set(existingDrawings.map((d) => d.name));

  let _createdDrawingsCount = 0;

  for (const def of drawingDefs) {
    if (existingDrawingNames.has(def.name)) {
      continue;
    }

    const drawing = await createDrawing({
      name: def.name,
      description: def.description,
      revision: def.revision,
      metadata: def.metadata,
    });

    // Generate and save test PDF
    const pdfBuffer = buildTestPdf(def.name);
    const fileName = `${drawing.id}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);
    await setDrawingFilePath(drawing.id, filePath);

    // Link projects
    for (const projectName of def.projects) {
      const projectId = projectMap[projectName];
      if (projectId) {
        await addDrawingToProject(drawing.id, projectId);
      }
    }

    // Link locations
    for (const locationName of def.locations) {
      const locationId = locationMap[locationName];
      if (locationId) {
        await addDrawingToLocation(drawing.id, locationId);
      }
    }

    _createdDrawingsCount++;
  }

  // --- Group-Project assignments ---
  const groupProjectAssignments: Record<string, string[]> = {
    Engineers: ['Dental Implants', 'Surgical Tools'],
    Designers: ['Crown & Bridge', 'Dental Implants'],
    Managers: ['Dental Implants', 'Surgical Tools', 'Crown & Bridge'],
  };

  for (const [groupName, projectNames] of Object.entries(groupProjectAssignments)) {
    const groupId = groupMap[groupName];
    if (!groupId) continue;
    for (const projectName of projectNames) {
      const projectId = projectMap[projectName];
      if (!projectId) continue;
      try {
        await addGroupToProject(groupId, projectId);
      } catch {
        // Ignore duplicate assignment errors
      }
    }
  }

  // --- User-Group memberships ---
  const managersGroupId = groupMap['Managers'];
  if (managersGroupId) {
    try {
      await addUserToGroup(config.adminEmail, managersGroupId);
    } catch {
      // Ignore duplicate membership errors
    }
  }

  // --- Summary ---
  const finalDrawings = await listDrawings();
  const finalProjects = await listProjects();
  const finalLocations = await listLocations();
  const finalGroups = await listGroups();

  console.log(
    `Seeded ${finalDrawings.length} drawings, ${finalProjects.length} projects, ${finalLocations.length} locations, ${finalGroups.length} groups`
  );
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
