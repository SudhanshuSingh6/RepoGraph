package com.example.jobs;

import com.example.jobs.reports.ReportJob;

public class JobsApplication {
    public static void main(String[] args) {
        new ReportJob().run();
        new CleanupJob().run();
    }
}
