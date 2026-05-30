'use strict';
// Seed data — mirrors db/setup_database.js. Used on Vercel where the
// DB file lives in /tmp and is recreated from scratch each cold start.
exports.CHILDREN = [
  { id:'JH-001', name:'Rahul Munda',   nameHi:'राहुल मुंडा',   age:'6 yrs', gender:'M', dob:'2020-04-12', weight_kg:18.5, height_cm:110.2, z_score:-0.5,  sam_mam_status:'Normal' },
  { id:'JH-002', name:'Priya Soren',   nameHi:'प्रिया सोरेन',  age:'5 yrs', gender:'F', dob:'2021-08-25', weight_kg:15.2, height_cm:105.0, z_score:-1.0,  sam_mam_status:'Normal' },
  { id:'JH-003', name:'Suresh Oraon',  nameHi:'सुरेश उरांव',   age:'4 yrs', gender:'M', dob:'2022-01-10', weight_kg:10.1, height_cm:95.5,  z_score:-3.5,  sam_mam_status:'SAM'    },
  { id:'JH-004', name:'Anita Toppo',   nameHi:'अनिता टोप्पो',  age:'4 yrs', gender:'F', dob:'2022-11-05', weight_kg:14.8, height_cm:102.1, z_score:-1.2,  sam_mam_status:'Normal' },
  { id:'JH-005', name:'Kavita Hansda', nameHi:'कविता हांसदा',  age:'3 yrs', gender:'F', dob:'2023-05-20', weight_kg:13.5, height_cm:98.0,  z_score:-0.8,  sam_mam_status:'Normal' },
];
