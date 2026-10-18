package com.example.jobs;

import com.example.jobs.reports.ReportJob;
import org.junit.jupiter.api.Test;

class ReportJobTest {
    @Test
    void runs() {
        new ReportJob().run();
    }
}
