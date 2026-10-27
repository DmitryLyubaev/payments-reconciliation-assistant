import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/ui',workers:1,fullyParallel:false,timeout:20000,use:{baseURL:'http://127.0.0.1:4314',headless:true,viewport:{width:1280,height:960}},webServer:{command:'node --import tsx tests/support/ui-server.ts',url:'http://127.0.0.1:4314',reuseExistingServer:false,timeout:30000}});
